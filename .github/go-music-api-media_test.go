package handler

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAudioStreamValidation(t *testing.T) {
	for _, body := range []string{`{"code":"error"}`, "<html>error</html>"} {
		r := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"audio/mpeg"}}, Body: io.NopCloser(strings.NewReader(body))}
		if _, _, err := prepareAudioStream(r, "bytes=0-4095", "bad"); err == nil {
			t.Fatal("accepted non-audio")
		}
	}
	data := make([]byte, 128)
	copy(data, "ID3")
	r := &http.Response{StatusCode: 206, Header: http.Header{"Content-Type": []string{"text/html"}}, Body: io.NopCloser(bytes.NewReader(data))}
	body, mime, err := prepareAudioStream(r, "bytes=0-4095", "jamendo:one")
	if err != nil || mime != "audio/mpeg" {
		t.Fatal("did not repair MIME", err, mime)
	}
	got, _ := io.ReadAll(body)
	if !bytes.Equal(got, data) {
		t.Fatal("consumed audio prefix")
	}
	r.Body = io.NopCloser(bytes.NewReader(data[64:]))
	_, mime, err = prepareAudioStream(r, "bytes=64-", "jamendo:one")
	if err != nil || mime != "audio/mpeg" {
		t.Fatal("corrected MIME lost on seek")
	}
	if _, _, err = prepareAudioStream(r, "bytes=64-", "other:one"); err == nil {
		t.Fatal("shared MIME across songs")
	}
}

func TestProbeStaysBoundedWhenCDNIgnoresRange(t *testing.T) {
	data := make([]byte, 100000)
	copy(data, "ID3")
	r := &http.Response{StatusCode: 200, ContentLength: int64(len(data)), Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data))}
	body, _, err := prepareAudioStream(r, "bytes=0-4095", "probe:one")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(body)
	if len(got) != 4096 || r.StatusCode != 206 || r.Header.Get("Content-Range") != "bytes 0-4095/100000" {
		t.Fatal("unbounded native probe", len(got), r.StatusCode, r.Header)
	}
}
