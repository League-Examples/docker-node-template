import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface ProtectedRouteProps {
  role: 'admin' | 'instructor'
  children: React.ReactNode
}

export function ProtectedRoute({ role, children }: ProtectedRouteProps) {
  const { user, loading } = useAuth()

  if (loading) return null

  if (!user) return <Navigate to="/login" />

  if (role === 'admin' && user.role !== 'ADMIN') {
    return <Navigate to={user.isActiveInstructor ? '/dashboard' : '/pending-activation'} />
  }

  if (role === 'instructor' && !user.isActiveInstructor) {
    return <Navigate to={user.role === 'ADMIN' ? '/admin' : '/pending-activation'} />
  }

  return <>{children}</>
}
