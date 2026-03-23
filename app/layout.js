import "./globals.css";

export const metadata = {
  title: "点众 AI 真人剧 Demo",
  description: "项目制 AI 真人剧工作台",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
