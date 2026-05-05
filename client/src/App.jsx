import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Landing   from './pages/Landing';
import Login     from './pages/Login';
import Dashboard from './pages/Dashboard';
import HR        from './pages/HR';
import ATS       from './pages/ATS';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route path="/" element={
            <ProtectedRoute><Landing /></ProtectedRoute>
          } />

          <Route path="/dashboard" element={
            <ProtectedRoute role="user"><Dashboard /></ProtectedRoute>
          } />

          <Route path="/hr" element={
            <ProtectedRoute role="hr"><HR /></ProtectedRoute>
          } />

          <Route path="/ats" element={
            <ProtectedRoute role="hr"><ATS /></ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
