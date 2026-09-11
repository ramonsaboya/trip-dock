import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TripDockApp } from '../../components/trip-dock-app';
import '../../app/globals.css';
import '../../app/theme.css';

createRoot(document.getElementById('root')!).render(<StrictMode><TripDockApp /></StrictMode>);
