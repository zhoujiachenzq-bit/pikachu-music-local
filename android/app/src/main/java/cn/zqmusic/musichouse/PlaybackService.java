package cn.zqmusic.musichouse;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/** Keeps the process, CPU and Wi-Fi awake while the WebView plays, and offers lock-screen controls. */
public class PlaybackService extends Service {
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ARTIST = "artist";
    static final String EXTRA_PLAYING = "playing";
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION = 7300;
    private static PlaybackService instance;

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private String title = "";
    private String artist = "";
    private boolean playing;

    static PlaybackService running() {
        return instance;
    }

    @Override
    @SuppressLint("WakelockTimeout")
    public void onCreate() {
        super.onCreate();
        instance = this;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "音乐播放", NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "musichouse:playback");
        wakeLock.setReferenceCounted(false);
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "musichouse:playback");
        wifiLock.setReferenceCounted(false);
        session = new MediaSession(this, "MusicHouse");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MusicPlaybackPlugin.sendAction("play"); }
            @Override public void onPause() { MusicPlaybackPlugin.sendAction("pause"); }
            @Override public void onSkipToNext() { MusicPlaybackPlugin.sendAction("next"); }
            @Override public void onSkipToPrevious() { MusicPlaybackPlugin.sendAction("previous"); }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (action != null) {
            MusicPlaybackPlugin.sendAction(action);
            return START_NOT_STICKY;
        }
        if (intent != null) {
            title = intent.getStringExtra(EXTRA_TITLE);
            artist = intent.getStringExtra(EXTRA_ARTIST);
            playing = intent.getBooleanExtra(EXTRA_PLAYING, false);
        }
        show(title, artist, playing);
        return START_NOT_STICKY;
    }

    void show(String nextTitle, String nextArtist, boolean nextPlaying) {
        title = nextTitle == null ? "" : nextTitle;
        artist = nextArtist == null ? "" : nextArtist;
        playing = nextPlaying;
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION, notification);
        }
        holdLocks(playing);
    }

    void finish() {
        stopForeground(true);
        stopSelf();
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return builder
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(open)
            .setOngoing(playing)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(action(android.R.drawable.ic_media_previous, "上一首", "previous", 1))
            .addAction(playing ? action(android.R.drawable.ic_media_pause, "暂停", "pause", 2) : action(android.R.drawable.ic_media_play, "播放", "play", 2))
            .addAction(action(android.R.drawable.ic_media_next, "下一首", "next", 3))
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    private Notification.Action action(int icon, String label, String name, int request) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(name);
        PendingIntent pending = PendingIntent.getService(this, request, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, pending).build();
    }

    @SuppressLint("WakelockTimeout")
    private void holdLocks(boolean hold) {
        if (hold) {
            if (!wakeLock.isHeld()) wakeLock.acquire();
            if (!wifiLock.isHeld()) wifiLock.acquire();
        } else {
            if (wakeLock.isHeld()) wakeLock.release();
            if (wifiLock.isHeld()) wifiLock.release();
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        finish();
    }

    @Override
    public void onDestroy() {
        holdLocks(false);
        session.release();
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}