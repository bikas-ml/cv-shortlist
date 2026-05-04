import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, role }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  if (role && session.role !== role) {
    return <Navigate to={session.role === 'hr' ? '/hr' : '/dashboard'} replace />;
  }
  return children;
}
