package handler

import (
	"bufio"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type audioTypeEntry struct {
	mime    string
	expires time.Time
}

var audioStreamClient = func() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 7 * time.Second
	return &http.Client{Transport: transport}
}()

var audioTypes = struct {
	sync.Mutex
	entries map[string]audioTypeEntry
}{entries: make(map[string]audioTypeEntry)}

func detectedAudioType(b []byte) string {
	s := string(b)
	if strings.HasPrefix(s, "ID3") {
		return "audio/mpeg"
	}
	if strings.HasPrefix(s, "fLaC") {
		return "audio/flac"
	}
	if strings.HasPrefix(s, "OggS") {
		return "audio/ogg"
	}
	if len(b) >= 12 && s[:4] == "RIFF" && s[8:12] == "WAVE" {
		return "audio/wav"
	}
	if len(b) >= 8 && s[4:8] == "ftyp" {
		return "audio/mp4"
	}
	if len(b) >= 4 && b[0] == 255 {
		if b[1]&224 == 224 && b[1]&6 != 0 && b[2]&240 != 240 {
			return "audio/mpeg"
		}
		if b[1]&246 == 240 {
			return "audio/aac"
		}
	}
	return ""
}

// Check bytes before forwarding headers. Peek leaves every byte available for playback.
// Remember corrected types briefly so later Range seeks need not start at a file header.
func prepareAudioStream(resp *http.Response, requestedRange, key string) (io.Reader, string, error) {
	timer := time.AfterFunc(7*time.Second, func() { _ = resp.Body.Close() })
	defer timer.Stop()
	bad := errors.New("upstream did not return audio")
	if resp.StatusCode != 200 && resp.StatusCode != 206 {
		return nil, "", bad
	}
	declared := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(declared, "json") || strings.Contains(declared, "xml") {
		return nil, "", bad
	}
	reader := bufio.NewReader(resp.Body)
	fromStart := resp.StatusCode == 200 || requestedRange == "" || strings.HasPrefix(requestedRange, "bytes=0-")
	if fromStart {
		prefix, err := reader.Peek(32)
		if err != nil && err != io.EOF {
			return nil, "", err
		}
		mime := detectedAudioType(prefix)
		if len(prefix) < 4 || mime == "" {
			return nil, "", bad
		}
		audioTypes.Lock()
		if len(audioTypes.entries) >= 256 {
			for old := range audioTypes.entries {
				delete(audioTypes.entries, old)
				break
			}
		}
		audioTypes.entries[key] = audioTypeEntry{mime, time.Now().Add(5 * time.Minute)}
		audioTypes.Unlock()
		return boundedAudioProbe(resp, reader, requestedRange), mime, nil
	}
	if strings.HasPrefix(declared, "audio/") || strings.HasPrefix(declared, "application/octet-stream") {
		return reader, declared, nil
	}
	audioTypes.Lock()
	cached, ok := audioTypes.entries[key]
	audioTypes.Unlock()
	if ok && cached.expires.After(time.Now()) {
		return reader, cached.mime, nil
	}
	return nil, "", bad
}

// Some CDNs ignore Range. Native HTTP buffers responses, so keep a probe small
// even in that case instead of accidentally downloading a whole song.
func boundedAudioProbe(resp *http.Response, reader io.Reader, requestedRange string) io.Reader {
	if requestedRange != "bytes=0-4095" || resp.StatusCode != 200 {
		return reader
	}
	total := resp.ContentLength
	limit := int64(4096)
	if total >= 0 && total < limit {
		limit = total
	}
	if limit <= 0 {
		return reader
	}
	totalText := "*"
	if total >= 0 {
		totalText = strconv.FormatInt(total, 10)
	}
	resp.StatusCode = 206
	resp.Header.Set("Content-Range", "bytes 0-"+strconv.FormatInt(limit-1, 10)+"/"+totalText)
	resp.Header.Set("Content-Length", strconv.FormatInt(limit, 10))
	resp.ContentLength = limit
	return io.LimitReader(reader, limit)
}
