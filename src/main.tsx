import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageContext';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { LogoProvider } from './logo/LogoContext';
import { SchedulingProvider } from './scheduling/SchedulingContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <LogoProvider>
            <SchedulingProvider>
              <App />
            </SchedulingProvider>
          </LogoProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
);
