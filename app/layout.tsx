import type { Metadata, Viewport } from "next";
import { Shell } from "@/components/Shell";
import "./globals.css";
export const metadata: Metadata = {
  title: "MLPT · Perception training",
  description:
    "Accessible, self-paced minimal light perception training with local session recording.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#101c30",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
