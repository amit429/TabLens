import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { TooltipProvider } from './ui/tooltip';
import { useSettings, useTheme } from '@/hooks/data';
import '@/styles.css';

function Root({ children }: { children: React.ReactNode }) {
  useTheme();
  const s = useSettings();
  const dark = s.theme === 'dark' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <TooltipProvider>
      {children}
      <Toaster
        position="bottom-center"
        theme={dark ? 'dark' : 'light'}
        toastOptions={{ className: '!font-sans !text-[13px] !rounded-[12px] !border-border', actionButtonStyle: { background: 'var(--foreground)', color: 'var(--background)', fontWeight: 600 } }}
      />
    </TooltipProvider>
  );
}

export function mount(App: React.ComponentType) {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root>
        <App />
      </Root>
    </React.StrictMode>,
  );
}
