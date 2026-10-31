package cn.zqmusic.musichouse;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MusicPlayback")
public class MusicPlaybackPlugin extends Plugin {
    private static MusicPlaybackPlugin active;
    private boolean askedForNotifications;

    @Override
    public void load() {
        active = this;
    }

    static void sendAction(String action) {
        if (active == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        active.notifyListeners("action", data, true);
    }

    @PluginMethod
    public void localMusicApi(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", LocalMusicApi.available(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        askForNotifications();
        PlaybackService service = PlaybackService.running();
        if (service != null) {
            service.show(title, artist, playing);
            call.resolve();
            return;
        }
        Context context = getContext();
        Intent intent = new Intent(context, PlaybackService.class)
            .putExtra(PlaybackService.EXTRA_TITLE, title)
            .putExtra(PlaybackService.EXTRA_ARTIST, artist)
            .putExtra(PlaybackService.EXTRA_PLAYING, playing);
        try {
            ContextCompat.startForegroundService(context, intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("无法启动后台播放服务", error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        PlaybackService service = PlaybackService.running();
        if (service != null) service.finish();
        call.resolve();
    }

    private void askForNotifications() {
        if (askedForNotifications || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        askedForNotifications = true;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        if (getActivity() != null) ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7301);
    }
}