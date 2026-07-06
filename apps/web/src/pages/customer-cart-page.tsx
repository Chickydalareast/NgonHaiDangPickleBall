import { Navigate, useParams } from 'react-router';

export function CustomerCartPage() {
  const { slug = '' } = useParams();

  return <Navigate to={`/s/${slug}?thanh-toan=1`} replace />;
}
