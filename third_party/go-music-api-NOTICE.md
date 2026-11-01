# go-music-api / music-lib

Upstream: https://github.com/guohuiyuan/go-music-api

Android builds use commit bacdfbe6cf6a5ba7331463d2039e3aac915c627f,
which pins music-lib v1.1.1-0.20260814153305-59dd7753bbc8.

Library source: https://github.com/guohuiyuan/music-lib

Both projects are licensed under GNU AGPL v3. See go-music-api-LICENSE.txt.
The complete pinned upstream source is publicly available at the links above;
the Android integration and TypeScript adaptations are in this repository.
Distributions must provide the corresponding source, including modifications,
under the applicable AGPL terms.

src/server/goMusicSearch.ts adapts the qq/song.go and migu/song.go search
protocols and metadata conversion for Android's native HTTP implementation.
It prefers standard MP3 for Migu. QQ search metadata is retained regardless of
the payplay flag; the playback endpoint still decides account entitlement.
The Android build applies .github/patches/qq-search-catalog.patch to the vendored
music-lib search function, removing only its anonymous VIP search filter.
The qianqian-search-catalog.patch likewise keeps paid catalogue metadata visible
without changing playback entitlement. The go-music-audio-stream.patch and
.github/go-music-api-media.go validate stream prefixes and normalize audio MIME;
these files and their Go regression test are part of the corresponding source.
It does not copy the IP spoofing headers or encrypted audio decryption code.

Source labels describe integration support, not entitlement to every song.
qq_wx is a login method for qq, not a separate music source.
Soda has no upstream song search; encrypted Soda audio is not supported here.
