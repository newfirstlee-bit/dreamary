import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dreamary 계정 및 데이터 삭제',
  description: 'Dreamary 계정과 계정에 연결된 데이터를 웹에서 삭제합니다.',
};

export default function AccountDeletionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
