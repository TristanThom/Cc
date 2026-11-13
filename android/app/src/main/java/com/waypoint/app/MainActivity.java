package com.waypoint.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OfferCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
