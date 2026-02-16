import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WebSocketProvider } from './hooks/useWebSocket.jsx';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <WebSocketProvider>
      <App />
    </WebSocketProvider>
  </BrowserRouter>
);
