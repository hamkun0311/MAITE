package com.oestewdio.maite;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.widget.FrameLayout;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

public class LetterboxLayout extends FrameLayout {
    private static final int ASPECT_WIDTH = 9;
    private static final int ASPECT_HEIGHT = 16;
    private static final int SYSTEM_AREAS = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();

    public LetterboxLayout(Context context, AttributeSet attrs) {
        super(context, attrs);
        ViewCompat.setOnApplyWindowInsetsListener(this, (view, insets) -> {
            Insets safeArea = insets.getInsets(SYSTEM_AREAS);
            setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom);
            // Web content already sits outside the system bars. Forward keyboard insets so focused inputs remain reachable.
            return new WindowInsetsCompat.Builder(insets).setInsets(SYSTEM_AREAS, Insets.NONE).build();
        });
    }

    @Override
    protected void measureChildWithMargins(View child, int widthSpec, int widthUsed, int heightSpec, int heightUsed) {
        int availableWidth = Math.max(0, MeasureSpec.getSize(widthSpec) - getPaddingLeft() - getPaddingRight());
        int availableHeight = Math.max(0, MeasureSpec.getSize(heightSpec) - getPaddingTop() - getPaddingBottom());
        int width = Math.min(availableWidth, availableHeight * ASPECT_WIDTH / ASPECT_HEIGHT);
        int height = Math.min(availableHeight, Math.round(width * (float) ASPECT_HEIGHT / ASPECT_WIDTH));
        child.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY));
    }
}
