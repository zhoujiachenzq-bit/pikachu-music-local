package main

import "C"

import (
	"context"
	"net"
	"net/http"
	"os"
	"time"
	"unsafe"

	"github.com/gin-gonic/gin"
	"github.com/guohuiyuan/go-music-api/router"
	"github.com/guohuiyuan/go-music-api/service"
)

// The Android build loads this as a library inside the app process, so the
// system cannot kill or freeze the service apart from the app.
//
//export Java_cn_zqmusic_musichouse_LocalMusicApi_nativeStart
func Java_cn_zqmusic_musichouse_LocalMusicApi_nativeStart(env, class unsafe.Pointer) {
	go serve()
}

func serve() {
	if home := os.Getenv("MUSIC_API_HOME"); home != "" {
		_ = os.Chdir(home)
	}
	service.CM.Load()
	r := router.SetupRouter()
	r.GET("/diag", diagnose)
	if err := r.Run("127.0.0.1:8080"); err != nil {
		panic(err)
	}
}

// diagnose reports what the search route swallows: it answers 200 with no songs
// whatever went wrong underneath.
func diagnose(c *gin.Context) {
	source := c.DefaultQuery("source", "qq")
	keyword := c.DefaultQuery("q", "晴天")
	report := gin.H{"source": source}
	hosts := map[string]string{"qq": "c.y.qq.com", "migu": "pd.musicapp.migu.cn", "kuwo": "search.kuwo.cn"}
	if host, known := hosts[source]; known {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
		defer cancel()
		addresses, err := net.DefaultResolver.LookupHost(ctx, host)
		report["dns"] = addresses
		if err != nil {
			report["dnsError"] = err.Error()
		}
		client := &http.Client{Timeout: 5 * time.Second}
		if response, err := client.Get("http://" + host + "/"); err != nil {
			report["httpError"] = err.Error()
		} else {
			report["http"] = response.StatusCode
			_ = response.Body.Close()
		}
	}
	if search := service.GetSearchFunc(source); search != nil {
		songs, err := search(keyword)
		report["songs"] = len(songs)
		if err != nil {
			report["searchError"] = err.Error()
		}
	}
	c.JSON(http.StatusOK, report)
}
