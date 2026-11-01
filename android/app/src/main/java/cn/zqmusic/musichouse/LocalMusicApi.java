package cn.zqmusic.musichouse;

import android.content.Context;
import android.system.ErrnoException;
import android.system.Os;
import java.io.File;

/** Runs the bundled go-music-api inside the app process, listening on 127.0.0.1 only. */
final class LocalMusicApi {
    private static boolean started;

    private LocalMusicApi() {}

    private static native void nativeStart();

    static boolean available(Context context) {
        return new File(context.getApplicationInfo().nativeLibraryDir, "libgomusic.so").exists();
    }

    static synchronized void start(Context context) {
        if (started || !available(context)) return;
        started = true;
        String home = context.getFilesDir().getPath();
        Thread loader = new Thread(() -> load(home), "local-music-api");
        loader.setDaemon(true);
        loader.start();
    }

    private static void load(String home) {
        try {
            Os.setenv("GIN_MODE", "release", true);
            Os.setenv("MUSIC_API_HOME", home, true);
            // Android 14+ moved the system roots into the Conscrypt APEX. Go's
            // Linux-style certificate lookup must see both old and new paths.
            Os.setenv("SSL_CERT_DIR", "/apex/com.android.conscrypt/cacerts:/system/etc/security/cacerts", true);
            System.loadLibrary("gomusic");
            nativeStart();
        } catch (ErrnoException | UnsatisfiedLinkError error) {
            android.util.Log.e("LocalMusicApi", "Could not start the music service", error);
        }
    }
}
