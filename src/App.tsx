import { useMemo, useRef, useState } from 'react';
import { useGestureControl } from './gesture/useGestureControl';

type PageKey = 'home' | 'shop' | 'social' | 'about';

type NavPage = { key: PageKey; label: string; description: string };

const pages: NavPage[] = [
  { key: 'home', label: 'Home', description: 'Overview and quick actions' },
  { key: 'shop', label: 'Shop', description: 'Gesture commerce widgets' },
  { key: 'social', label: 'Social', description: 'Feed + engagement demo' },
  { key: 'about', label: 'About', description: 'Product and roadmap' },
];

const products = [
  { id: 'p1', name: 'Air Cursor Ring', price: '$59' },
  { id: 'p2', name: 'Gesture Haptic Band', price: '$89' },
  { id: 'p3', name: 'Wave Hub Dock', price: '$129' },
  { id: 'p4', name: 'Motion Light Pack', price: '$39' },
];

export function App() {
  const [enabled, setEnabled] = useState(false);
  const [activePage, setActivePage] = useState<PageKey>('home');
  const [likes, setLikes] = useState(1260);
  const [cartCount, setCartCount] = useState(0);
  const [bookmarks, setBookmarks] = useState(47);
  const [search, setSearch] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const gesture = useGestureControl({ enabled, videoRef, snapRadius: 92 });

  const enableLabel = useMemo(
    () => (enabled ? 'Disable Gesture Control' : 'Enable Gesture Control'),
    [enabled],
  );

  const activeInfo = pages.find((page) => page.key === activePage) ?? pages[0];

  const filteredProducts = useMemo(
    () => products.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())),
    [search],
  );

  return (
    <main className="page">
      <nav className="topbar">
        <h1>Motion OS Web</h1>
        <div className="topbar-actions">
          <input
            aria-label="Search products"
            placeholder="Search products"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button onClick={() => setEnabled((prev) => !prev)}>{enableLabel}</button>
        </div>
      </nav>

      <section className="page-tabs" aria-label="Website pages">
        {pages.map((page) => (
          <button
            key={page.key}
            className={page.key === activePage ? 'tab active' : 'tab'}
            onClick={() => setActivePage(page.key)}
          >
            {page.label}
          </button>
        ))}
      </section>

      <section className="status-strip" aria-live="polite">
        <span>Status: {gesture.status}</span>
        <span>{gesture.cameraReady ? 'Camera ready' : 'Camera inactive'}</span>
        <span>{gesture.scrollModeActive ? 'Open-palm scroll mode' : 'Index-pointer mode'}</span>
        <span>Pinch confidence: {(gesture.pinchConfidence * 100).toFixed(0)}%</span>
        <span>Cart: {cartCount}</span>
        <span>Likes: {likes}</span>
        <span>Bookmarks: {bookmarks}</span>
      </section>

      <section className="hero">
        <div>
          <h2>{activeInfo.label}: {activeInfo.description}</h2>
          <p>
            Cursor follows index finger. Pinch must be stable before click fires. Open palm enables scroll mode (hand down scrolls up / hand up scrolls down).
          </p>
          <div className="hero-actions">
            <button onClick={() => setLikes((prev) => prev + 1)}>Like</button>
            <button onClick={() => setBookmarks((prev) => prev + 1)}>Bookmark</button>
            <button onClick={() => setActivePage('shop')}>Go to Shop</button>
            <button onClick={() => setActivePage('social')}>Go to Social</button>
          </div>
        </div>
        <div className="camera-wrap" aria-label="Camera preview">
          <video ref={videoRef} className="camera" autoPlay muted playsInline />
        </div>
      </section>

      {activePage === 'home' && (
        <section className="dashboard-grid" aria-label="Home dashboard cards">
          <article className="panel-card">
            <h3>Engagement Snapshot</h3>
            <p>Use pinch to open details and palm-scroll for long reports.</p>
            <button onClick={() => setActivePage('social')}>Open social analytics</button>
          </article>
          <article className="panel-card">
            <h3>Sales Snapshot</h3>
            <p>Quick switch to commerce panel and add products using gesture clicks.</p>
            <button onClick={() => setActivePage('shop')}>Open commerce</button>
          </article>
          <article className="panel-card">
            <h3>System Health</h3>
            <p>Camera + gesture engine optimized for stable 30–60fps interaction.</p>
            <button onClick={() => setActivePage('about')}>View architecture</button>
          </article>
        </section>
      )}

      {activePage === 'shop' && (
        <section className="product-grid" aria-label="Store products">
          {filteredProducts.map((item) => (
            <article key={item.id} className="product-item">
              <h3>{item.name}</h3>
              <p>{item.price}</p>
              <div className="stack-actions">
                <button onClick={() => setCartCount((prev) => prev + 1)}>Add to cart</button>
                <button onClick={() => setBookmarks((prev) => prev + 1)}>Save for later</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {activePage === 'social' && (
        <section className="feed" aria-label="Social feed">
          {Array.from({ length: 18 }).map((_, index) => (
            <article key={index} className="feed-item">
              <h4>Creator Post #{index + 1}</h4>
              <p>
                High engagement content card with gesture-ready controls. Keep index finger for pointer and open hand to scroll this feed naturally.
              </p>
              <div className="stack-actions">
                <button onClick={() => setLikes((prev) => prev + 1)}>Like post</button>
                <button onClick={() => setBookmarks((prev) => prev + 1)}>Save post</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {activePage === 'about' && (
        <section className="about-panel" aria-label="About architecture">
          <h3>Gesture Architecture</h3>
          <ul>
            <li>Index-only cursor movement</li>
            <li>Stable pinch state machine (IDLE → PINCHING → CLICKED → RELEASED)</li>
            <li>Dynamic threshold based on hand size</li>
            <li>Open-palm page scrolling</li>
            <li>Adaptive smoothing + acceleration clamps</li>
          </ul>
          <button onClick={() => setActivePage('home')}>Back to home</button>
        </section>
      )}

      {enabled && (
        <div
          className={`gesture-cursor ${gesture.depthTouchActive ? 'gesture-cursor-touch' : ''} ${
            gesture.scrollModeActive ? 'gesture-cursor-scroll' : ''
          }`.trim()}
          style={{ transform: `translate(${gesture.cursor.x}px, ${gesture.cursor.y}px)` }}
        />
      )}
    </main>
  );
}
