package com.devkodz.optionpulse;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Serves exactly one file — the downloaded update APK — to the system package installer. */
public class ApkProvider extends ContentProvider {

    static final String AUTHORITY = "com.devkodz.optionpulse.apkprovider";
    static final String NAME = "OptionPulse-update.apk";

    static File updateFile(android.content.Context context) {
        File dir = new File(context.getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, NAME);
    }

    static Uri updateUri() {
        return Uri.parse("content://" + AUTHORITY + "/" + NAME);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!NAME.equals(uri.getLastPathSegment()) || !"r".equals(mode)) throw new FileNotFoundException(uri.toString());
        File f = updateFile(getContext());
        if (!f.exists()) throw new FileNotFoundException(uri.toString());
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f = updateFile(getContext());
        MatrixCursor c = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[] {NAME, f.length()});
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
