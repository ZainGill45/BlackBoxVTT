import {
  Brush,
  LogOut,
  PenTool,
  Power,
  Settings2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '../../components/ui/IconButton';
import { IconTabs } from '../../components/ui/IconTabs';
import { QuickActionButton } from '../../components/ui/QuickActionButton';
import { MapStage, type MapStageControls } from './MapStage';
import { ScenePanel } from './scenes/ScenePanel';
import { useAssetThumbnails } from './scenes/useAssetThumbnails';
import { useScenes } from './scenes/useScenes';
import { StoragePanel } from './StoragePanel';
import {
  createDefaultServerSettings,
  OFFLINE_SERVER_STATUS,
} from './serverSettings';
import { ServerSettingsPanel } from './ServerSettingsPanel';
import { PaintSettingsModal } from './PaintSettingsModal';
import {
  loadPaintSettings,
  savePaintSettings,
  stepPaintWidth,
  type PaintSettings,
  type PaintSubtool,
} from './paintSettings';
import {
  fogTool,
  playerTools,
  playLayers,
  quickActions,
  sidebarTabs,
} from './playConfig';
import type {
  PlayLayerId,
  PlayScreenProps,
  PlayToolId,
  SidebarTabId,
} from './types';
import styles from './PlayScreen.module.css';

function getSessionTitle(session: PlayScreenProps['session']) {
  return session.source === 'local'
    ? `${session.campaignName} — Game Master`
    : `Remote campaign at ${session.host}:${session.port} — Player`;
}

export function PlayScreen({
  assetApi,
  onExit,
  onCreateServerUser,
  onDeleteServerUser,
  onLayerChange,
  onLogout,
  onQuickAction,
  onServerPasswordReset,
  onServerPortChange,
  onServerUsernameChange,
  onSidebarTabChange,
  onToolChange,
  onTransformPreviewRateChange,
  sceneApi,
  serverSettings = createDefaultServerSettings(),
  serverStatus = OFFLINE_SERVER_STATUS,
  session,
}: PlayScreenProps) {
  const [activeTool, setActiveTool] = useState<PlayToolId>('select');
  const [activeLayer, setActiveLayer] = useState<PlayLayerId>('token');
  const [paintSettings, setPaintSettings] = useState<PaintSettings>(() =>
    loadPaintSettings(session),
  );
  const [paintSettingsOpen, setPaintSettingsOpen] = useState(false);
  const [paintSubtool, setPaintSubtool] =
    useState<PaintSubtool>('freeform');
  const [activeSidebarTab, setActiveSidebarTab] =
    useState<SidebarTabId>('chat');
  const stageControls = useRef<MapStageControls>(null);
  const scenes = useScenes(sceneApi, session.campaignId, session.role === 'gm');
  const sceneImageIds = useMemo(
    () =>
      scenes.scenes
        .map((scene) => scene.mapImage?.assetId)
        .filter((assetId): assetId is string => assetId !== undefined),
    [scenes.scenes],
  );
  // Built here, at campaign open, because the panel below unmounts on every
  // sidebar tab switch and would otherwise re-decode every map on each visit.
  const scenePreviews = useAssetThumbnails(
    assetApi,
    session.campaignId,
    sceneImageIds,
  );
  const tools =
    session.role === 'gm' ? [...playerTools, fogTool] : playerTools;
  const activeSidebar =
    sidebarTabs.find((tab) => tab.id === activeSidebarTab) ?? sidebarTabs[0];
  const SidebarIcon = activeSidebar.icon;
  const showServerSettings =
    activeSidebarTab === 'settings' && session.role === 'gm';
  const showStorage = activeSidebarTab === 'storage' && assetApi !== undefined;
  // Only the game master manages scenes; players just receive the presented one.
  const showScenes =
    activeSidebarTab === 'scenes' &&
    session.role === 'gm' &&
    sceneApi !== undefined;

  useEffect(() => {
    savePaintSettings(session, paintSettings);
  }, [paintSettings, session]);

  useEffect(() => {
    const handlePaintWidthShortcut = (event: KeyboardEvent) => {
      if (
        activeTool !== 'paint' ||
        (event.code !== 'BracketLeft' &&
          event.code !== 'BracketRight') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, select, textarea') ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      const direction = event.code === 'BracketLeft' ? -1 : 1;
      setPaintSettings((current) => {
        if (paintSubtool === 'freeform') {
          return {
            ...current,
            freeform: {
              ...current.freeform,
              width: stepPaintWidth(current.freeform.width, direction),
            },
          };
        }
        return {
          ...current,
          polyline: {
            ...current.polyline,
            width: stepPaintWidth(current.polyline.width, direction),
          },
        };
      });
    };
    window.addEventListener('keydown', handlePaintWidthShortcut);
    return () => window.removeEventListener('keydown', handlePaintWidthShortcut);
  }, [activeTool, paintSubtool]);

  const handleToolChange = (id: PlayToolId) => {
    setActiveTool(id);
    onToolChange?.(id);
  };

  const handleLayerChange = (id: PlayLayerId) => {
    setActiveLayer(id);
    onLayerChange?.(id);
  };

  const handleSidebarChange = (id: SidebarTabId) => {
    setActiveSidebarTab(id);
    onSidebarTabChange?.(id);
  };

  return (
    <section className={styles.screen} aria-labelledby="play-screen-title">
      <h1 id="play-screen-title" className="sr-only">
        {getSessionTitle(session)}
      </h1>

      <MapStage
        activeLayer={activeLayer}
        activeTool={activeTool}
        assetApi={assetApi}
        controlsRef={stageControls}
        scene={scenes.viewedScene}
        session={session}
        onActiveLayerChange={handleLayerChange}
        onCommitImages={scenes.setImages}
        onCommitObjects={scenes.setObjects}
        onRedo={scenes.redo}
        onUndo={scenes.undo}
        paintSettings={paintSettings}
        paintSubtool={paintSubtool}
      />

      <div
        className={styles.leftStack}
        role="toolbar"
        aria-label="Play controls"
      >
        <IconButton icon={Power} label="Exit application" onClick={onExit} />
        <IconButton icon={LogOut} label="Logout" onClick={onLogout} />
        {tools.map((tool) =>
          tool.id === 'paint' ? (
            <div className={styles.paintTool} key={tool.id}>
              <IconButton
                active={activeTool === tool.id}
                aria-pressed={activeTool === tool.id}
                icon={tool.icon}
                label={tool.label}
                onClick={() => handleToolChange(tool.id)}
              />
              {activeTool === 'paint' ? (
                <div
                  aria-label="Paint tools"
                  className={styles.paintSubtools}
                  role="toolbar"
                >
                  <IconButton
                    active={paintSubtool === 'freeform'}
                    aria-pressed={paintSubtool === 'freeform'}
                    icon={Brush}
                    label="Freeform paint"
                    onClick={() => setPaintSubtool('freeform')}
                  />
                  <IconButton
                    active={paintSubtool === 'polyline'}
                    aria-pressed={paintSubtool === 'polyline'}
                    icon={PenTool}
                    label="Polyline pen"
                    onClick={() => setPaintSubtool('polyline')}
                  />
                  <IconButton
                    icon={Settings2}
                    label="Paint settings"
                    onClick={() => setPaintSettingsOpen(true)}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <IconButton
              key={tool.id}
              active={activeTool === tool.id}
              aria-pressed={activeTool === tool.id}
              icon={tool.icon}
              label={tool.label}
              onClick={() => handleToolChange(tool.id)}
            />
          ),
        )}
      </div>

      {session.role === 'gm' ? (
        <div
          className={styles.layerGroup}
          role="toolbar"
          aria-label="Map layers"
        >
          {playLayers.map((layer) => (
            <IconButton
              key={layer.id}
              active={activeLayer === layer.id}
              aria-pressed={activeLayer === layer.id}
              icon={layer.icon}
              label={layer.label}
              onClick={() => handleLayerChange(layer.id)}
            />
          ))}
        </div>
      ) : null}

      <div
        className={styles.quickActions}
        role="toolbar"
        aria-label="Quick actions"
      >
        {quickActions.map((action) => (
          <QuickActionButton
            key={action.id}
            icon={action.icon}
            label={action.label}
            onClick={() => {
              if (action.id === 'center-view') {
                stageControls.current?.centerView();
              }
              onQuickAction?.(action.id);
            }}
          />
        ))}
      </div>

      <div className={styles.sidebarOverlay}>
        <IconTabs
          activeId={activeSidebarTab}
          ariaLabel="Campaign sidebar"
          className={styles.sidebarTabs}
          itemClassName={styles.sidebarTab}
          items={sidebarTabs}
          onChange={handleSidebarChange}
        />

        <aside className={styles.sidebarPanel}>
          <section
            id={activeSidebar.panelId}
            role="tabpanel"
            aria-labelledby={`${activeSidebar.panelId}-tab`}
            className={
              showServerSettings || showStorage || showScenes
                ? styles.settingsPanelContent
                : styles.sidebarPanelContent
            }
          >
            {showServerSettings ? (
              <ServerSettingsPanel
                key={serverSettings.port}
                settings={serverSettings}
                status={serverStatus}
                onCreateUser={onCreateServerUser ?? (() => undefined)}
                onDeleteUser={onDeleteServerUser ?? (() => undefined)}
                onPortChange={onServerPortChange ?? (() => undefined)}
                onTransformPreviewRateChange={
                  onTransformPreviewRateChange ?? (() => undefined)
                }
                onResetPassword={
                  onServerPasswordReset ?? (() => undefined)
                }
                onUpdateUsername={
                  onServerUsernameChange ?? (() => undefined)
                }
              />
            ) : showStorage ? (
              <StoragePanel
                assetApi={assetApi}
                campaignId={session.campaignId}
                canDragImages={session.role === 'gm'}
                onDetachFromScenes={
                  sceneApi ? scenes.detachAsset : undefined
                }
                onFindSceneDependents={
                  sceneApi ? scenes.findDependents : undefined
                }
              />
            ) : showScenes ? (
              <ScenePanel
                assetApi={assetApi}
                campaignId={session.campaignId}
                thumbnails={scenePreviews}
                store={scenes}
              />
            ) : (
              <div
                className={styles.sidebarPanelIcon}
                data-sidebar-icon={activeSidebar.id}
              >
                <SidebarIcon aria-hidden size="5rem" strokeWidth={1} />
              </div>
            )}
          </section>
        </aside>
      </div>

      <PaintSettingsModal
        key={paintSettingsOpen ? 'open' : 'closed'}
        isOpen={paintSettingsOpen}
        settings={paintSettings}
        onChange={setPaintSettings}
        onDismiss={() => setPaintSettingsOpen(false)}
      />
    </section>
  );
}
