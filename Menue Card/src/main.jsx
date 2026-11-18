import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// StrictMode is left off on purpose: react-pageflip builds its book once on
// mount and does not survive the double-mount that StrictMode does in dev.
createRoot(document.getElementById('root')).render(<App />);
