import './globals.css';
import Navbar from '@/components/Navbar';

export const metadata = {
  title: 'SmartCart',
  description: 'SmartCart: a microservices e-commerce project',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
