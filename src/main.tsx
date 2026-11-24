import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './context/ThemeContext';
import { UiModeProvider } from './context/UiModeContext';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <UiModeProvider>
      <App />
    </UiModeProvider>
  </ThemeProvider>
);
