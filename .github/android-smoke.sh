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
tap '[网酷]'
sleep 20
shot playing
state before-screen-off

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
