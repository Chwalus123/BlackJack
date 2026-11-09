import { lazy, Suspense } from 'preact/compat';
import { route } from './router';
import { Landing } from '../screens/Landing';
import { ModeSelect, type GameKind } from '../screens/ModeSelect';
import { Settings } from '../screens/Settings';
import { Rules } from '../screens/Rules';
import { ToastStack } from '../ui/chrome';
import { t } from '../i18n';

const SoloSetup = lazy(() => import('../screens/SoloSetup').then((m) => ({ default: m.SoloSetup })));
const TableScreen = lazy(() => import('../screens/TableScreen').then((m) => ({ default: m.TableScreen })));
const Sandbox = lazy(() => import('../screens/Sandbox').then((m) => ({ default: m.Sandbox })));
const Lobby = lazy(() => import('../screens/mp/Lobby').then((m) => ({ default: m.Lobby })));
const CreateRoom = lazy(() => import('../screens/mp/CreateRoom').then((m) => ({ default: m.CreateRoom })));
const RoomScreen = lazy(() => import('../screens/mp/RoomScreen').then((m) => ({ default: m.RoomScreen })));

const isGame = (g: string | undefined): g is GameKind => g === 'blackjack' || g === 'holdem';

function Loading() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: 'var(--c-gold300)', fontFamily: 'var(--font-display)', letterSpacing: '0.14em' }}>
      {t('app.loading')}
    </div>
  );
}

function Router() {
  const { parts, query } = route.value;
  const [a, b, c] = parts;
  if (!a) return <Landing />;
  if (a === 'settings') return <Settings />;
  if (a === 'sandbox') return <Sandbox />;
  if (a === 'rules' && isGame(b)) return <Rules game={b} />;
  if (a === 'lobby' && b === 'new') return <CreateRoom game={isGame(query.get('game') ?? '') ? (query.get('game') as GameKind) : 'blackjack'} />;
  if (a === 'lobby') return <Lobby game={isGame(query.get('game') ?? '') ? (query.get('game') as GameKind) : null} />;
  if (a === 'r' && b) return <RoomScreen code={b.toUpperCase()} />;
  if (isGame(a)) {
    if (b === 'solo' && c === 'table') return <TableScreen game={a} mode="solo" />;
    if (b === 'solo') return <SoloSetup game={a} />;
    return <ModeSelect game={a} />;
  }
  return <Landing />;
}

export function App() {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <Router />
      </Suspense>
      <ToastStack />
    </>
  );
}
