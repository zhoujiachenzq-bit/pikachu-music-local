package cn.zqmusic.musichouse;

import android.content.Context;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;

/** Runs the bundled go-music-api, which listens on 127.0.0.1 only. */
final class LocalMusicApi {
    private static final int MAX_RESTARTS = 3;
    private static boolean started;

    private LocalMusicApi() {}

    static boolean available(Context context) {
        return executable(context).exists();
    }

    static synchronized void start(Context context) {
        if (started || !available(context)) return;
        started = true;
        Context app = context.getApplicationContext();
        Thread supervisor = new Thread(() -> supervise(app), "local-music-api");
        supervisor.setDaemon(true);
        supervisor.start();
    }

    private static File executable(Context context) {
        return new File(context.getApplicationInfo().nativeLibraryDir, "libgomusic.so");
    }

    private static void supervise(Context context) {
        for (int attempt = 0; attempt <= MAX_RESTARTS; attempt++) {
            try {
                ProcessBuilder builder = new ProcessBuilder(executable(context).getPath())
                    .directory(context.getFilesDir())
                    .redirectErrorStream(true);
                builder.environment().put("GIN_MODE", "release");
                Process process = builder.start();
                discard(process.getInputStream());
                process.waitFor();
                Thread.sleep(1000);
            } catch (IOException error) {
                return;
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    // An unread pipe fills up and would stall the service.
    private static void discard(InputStream output) throws IOException {
        byte[] buffer = new byte[4096];
        while (output.read(buffer) != -1) {
            // Nothing here is needed.
        }
    }
}
