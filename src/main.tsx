import { createRoot } from 'react-dom/client';
import './lib/gsapSetup';
import { ThemeProvider } from './context/ThemeContext';
import { UiModeProvider } from './context/UiModeContext';
import { PrivacyBlurProvider } from './context/PrivacyBlurContext';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <UiModeProvider>
      <PrivacyBlurProvider>
        <App />
      </PrivacyBlurProvider>
    </UiModeProvider>
  </ThemeProvider>
);
