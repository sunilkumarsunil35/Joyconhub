package io.github.sunilkumarsunil35.money;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts in super.onCreate().
        registerPlugin(BankSmsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
