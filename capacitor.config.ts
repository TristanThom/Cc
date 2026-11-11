import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.shiftodo.app',
  appName: 'ShiftOdo',
  webDir: 'dist',
  backgroundColor: '#0F172A',
  plugins: {
    // The app paints its own dark strips behind the status and navigation bars.
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover', style: 'DARK' },
  },
}

export default config
