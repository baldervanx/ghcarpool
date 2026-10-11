import React from 'react';
import type { PropsWithChildren } from 'react';
import { useSelector } from 'react-redux';
import { Navigate, useLocation } from 'react-router-dom';
import type { AppStore } from '@/store';

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { user, isMember } = useSelector((state: AppStore) => state.auth);
  const location = useLocation();
  if (!user || !isMember) {
    const returnTo = location.pathname + location.search + location.hash;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return children;
}
