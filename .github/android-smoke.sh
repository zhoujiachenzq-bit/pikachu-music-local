#!/usr/bin/env bash
# Launches the APK twice, starts a song, turns the screen off and forces Doze,
# then records whether the app is still playing. Evidence goes to keepalive.txt.
set -u
pkg=cn.zqmusic.musichouse

shot() { adb exec-out screencap -p > "$1.png"; }

# Taps the first on-screen node whose text or class matches; WebView nodes appear in the dump.
tap() {
  # uiautomator sometimes dies on a busy WebView, so a failed look is retried.
  for attempt in 1 2 3 4 5 6; do
    rm -f ui.xml
    adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
    adb pull /sdcard/ui.xml ui.xml > /dev/null 2>&1
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
sleep 12
shot search-results
adb forward tcp:18080 tcp:8080
for source in qq migu kuwo; do
  echo "=== service $source" >> keepalive.txt
  curl -s --max-time 25 "http://127.0.0.1:18080/diag?source=$source" >> keepalive.txt
  echo >> keepalive.txt
  curl -s --max-time 12 "http://127.0.0.1:18080/api/v1/music/search?q=jay&type=song&sources=$source" | head -c 400 >> keepalive.txt
  echo >> keepalive.txt
done
# The keyboard stays open, so the first result row sits at a fixed spot.
adb shell input tap 150 300
sleep 3
shot first-tap
sleep 22
shot playing
state before-screen-off
# Plays a QQ or Migu result too: with the other two sources off, they are all that is left.
tap '网易云'
sleep 1
tap '酷我'
sleep 1
tap '搜索'
sleep 10
shot search-qq-migu
adb shell input keyevent 4
sleep 1
adb shell input tap 150 300
sleep 3
shot qq-first-row
sleep 7
adb shell input tap 150 365
sleep 3
shot qq-second-row
sleep 17
shot playing-qq-migu
state qq-migu-playing

adb shell dumpsys battery unplug
adb shell input keyevent 223
sleep 30
state screen-off-30s
adb shell dumpsys deviceidle force-idle
sleep 90
state doze-90s
sleep 60
state doze-150s

adb shell dumpsys deviceidle unforce
adb shell dumpsys battery reset
adb shell input keyevent 224
adb shell wm dismiss-keyguard
sleep 3
shot after-wake
adb logcat -d > logcat.txt
adb shell pidof "$pkg"
