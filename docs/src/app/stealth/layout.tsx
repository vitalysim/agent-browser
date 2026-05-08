import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata("stealth");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
