import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageContext';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { LogoProvider } from './logo/LogoContext';
import { SchedulingProvider } from './scheduling/SchedulingContext';
import { MachinesProvider } from './machines/MachinesContext';
import { RolesProvider } from './roles/RolesContext';
import { WorkersProvider } from './workers/WorkersContext';
import { ShiftsProvider } from './shifts/ShiftsContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsProvider } from './settings/SettingsContext';
import { startOfflineSync } from './sync/offlineQueue';
import { HashRouter } from 'react-router-dom';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: true } },
});
startOfflineSync();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <SettingsProvider>
      <LanguageProvider>
        <AuthProvider>
          <LogoProvider>
            <MachinesProvider>
              <RolesProvider>
                <WorkersProvider>
                  <ShiftsProvider>
                    <SchedulingProvider>
                      <HashRouter>
                        <App />
                      </HashRouter>
                    </SchedulingProvider>
                  </ShiftsProvider>
                </WorkersProvider>
              </RolesProvider>
            </MachinesProvider>
          </LogoProvider>
        </AuthProvider>
      </LanguageProvider>
      </SettingsProvider>
    </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
