#!/usr/bin/env bash
# Launches the APK twice, starts a song, turns the screen off and forces Doze,
# then records whether the app is still playing. Evidence goes to keepalive.txt.
set -euo pipefail
pkg=cn.zqmusic.musichouse

shot() { adb exec-out screencap -p > "$1.png"; }

# Taps the first on-screen node whose text or class matches; WebView nodes appear in the dump.
tap() {
  # uiautomator sometimes dies on a busy WebView, so a failed look is retried.
  for attempt in 1 2 3 4 5 6; do
    rm -f ui.xml
    adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 || true
    adb pull /sdcard/ui.xml ui.xml > /dev/null 2>&1 || true
    point=$(python3 - "$1" <<'PY'
import re, sys
import xml.etree.ElementTree as ET
pattern = re.compile(sys.argv[1])
try:
    nodes = list(ET.parse('ui.xml').iter('node'))
except Exception:
    nodes = []
for node in nodes:
    label = node.get('text') or node.get('content-desc') or ''
    if pattern.fullmatch(label) or pattern.fullmatch(node.get('class') or ''):
        left, top, right, bottom = map(int, re.findall(r'\d+', node.get('bounds')))
        print((left + right) // 2, (top + bottom) // 2)
        break
PY
    )
    if [ -n "$point" ]; then
      echo "tap '$1' at $point (attempt $attempt)" | tee -a keepalive.txt
      adb shell input tap $point
      return 0
    fi
    sleep 4
  done
  echo "tap '$1' FOUND NOTHING" | tee -a keepalive.txt
  return 1
}

state() {
  {
    echo "=== $1 $(date +%T)"
    adb shell dumpsys power | grep -E 'mWakefulness=|musichouse' || true
    adb shell dumpsys deviceidle | grep -E 'mState=' || true
    adb shell dumpsys activity services "$pkg" | grep -E 'ServiceRecord.*PlaybackService|isForeground=' || true
    adb shell dumpsys media_session | grep -A12 'MusicHouse' | grep -E 'MusicHouse|active=|state=PlaybackState|metadata' || true
    adb shell dumpsys notification --noredact | grep -E 'pkg=cn.zqmusic' | head -n 2 || true
    adb shell dumpsys audio | grep 'AudioPlaybackConfiguration' | grep -E 'state:started' || echo 'no started player'
  } | tee -a keepalive.txt
}

assert_playing() {
  adb shell dumpsys media_session > media-session.txt
  python3 - <<'PY'
import re
text = open('media-session.txt', encoding='utf-8').read()
if 'MusicHouse' not in text:
    raise SystemExit('Music House media session is absent')
session = text.split('MusicHouse', 1)[1][:2200]
if not re.search(r'state=PlaybackState\s*\{state=3\b', session):
    raise SystemExit('Music House is not actually playing')
PY
}

wait_playing() {
  for attempt in $(seq 1 20); do
    if assert_playing > /dev/null 2>&1; then return 0; fi
    sleep 3
  done
  assert_playing
}

trap 'adb logcat -d > logcat.txt; shot final-state' EXIT
adb install -g app.apk
adb shell am start -n "$pkg/.MainActivity"
sleep 30
shot first-launch
adb shell am force-stop "$pkg"
adb shell am start -n "$pkg/.MainActivity"
sleep 15
shot second-launch

tap '搜索'
sleep 2
tap 'android\.widget\.EditText'
sleep 1
adb shell input text jay
adb shell input keyevent 66
sleep 10
adb shell input keyevent 4
sleep 2
# Filter using actual visible controls. Fixed coordinates hit source checkboxes
# after the search layout grew, so the old script never started playback.
for source in 咪咕 网易云 酷我 酷狗 千千 5sing Jamendo JOOX 哔哩哔哩; do
  tap "$source"
done
tap '搜索'
sleep 10
shot search-results
adb forward tcp:18080 tcp:8080
tap 'Q (发如雪|晴天|七里香) .*'
sleep 15
tap '播放'
sleep 3
shot playing
wait_playing
state before-screen-off

# Back on the home page must leave the app running in the background.
adb shell input keyevent 4
sleep 8
state after-back
assert_playing

adb shell dumpsys battery unplug
adb shell input keyevent 223
sleep 30
state screen-off-30s
assert_playing
adb shell dumpsys deviceidle force-idle
sleep 90
state doze-90s
assert_playing
sleep 60
state doze-150s
assert_playing

adb shell dumpsys deviceidle unforce
adb shell dumpsys battery reset
adb shell input keyevent 224
adb shell wm dismiss-keyguard
sleep 3
shot after-wake
# Diagnostics are best-effort and run after playback assertions. An optional
# provider diagnostic timeout must not prevent the test from tapping a song.
for source in qq migu kuwo; do
  echo "=== service $source" >> keepalive.txt
  curl -s --max-time 15 "http://127.0.0.1:18080/diag?source=$source" >> keepalive.txt || echo 'diagnostic unavailable' >> keepalive.txt
  echo >> keepalive.txt
done
adb logcat -d > logcat.txt
adb shell pidof "$pkg"
