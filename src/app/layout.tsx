import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import ClientLayoutWrapper from "./ClientLayoutWrapper";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Dreamary",
  description: "AI 캐릭터와 함께 쓰는 교환일기와 채팅 서비스",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <script type="text/javascript" dangerouslySetInnerHTML={{
          __html: `
            if (typeof window !== 'undefined' && window.localStorage.getItem('block_analytics') !== 'true') {
              (function(c,l,a,r,i,t,y){
                  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
              })(window, document, "clarity", "script", "xf119l2gmb");
            }
          `
        }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ClientLayoutWrapper>
          {children}
        </ClientLayoutWrapper>
      </body>
    </html>
  );
}
