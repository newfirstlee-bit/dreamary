export function generateStaticParams() {
  return [{ id: '1' }];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
