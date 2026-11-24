// Body-level overlay: the save toast, the scan pill, the outliers-only rail,
// the full-analysis side panel, the reel lightbox and a post's stats card. The per-post buttons, grid badges and profile strip live inside
// Instagram's own DOM and are mounted by runtime.tsx.
import { Show } from 'solid-js';
import Lightbox from './Lightbox';
import OutlierGrid from './OutlierGrid';
import OutlierRail from './OutlierRail';
import ProfilePanel from './ProfilePanel';
import type { Runtime } from './runtime';
import ScanPill from './ScanPill';
import StatsCard from './StatsCard';
import Toast from './Toast';

export default function ContentApp(props: { rt: Runtime }) {
  const rt = props.rt;
  return (
    <>
      <Toast saves={rt.saves} theme={rt.theme} />
      <Show when={rt.rail()}>
        {(rail) => (
          <OutlierRail
            store={rail().store}
            geom={rail().geom}
            saves={rt.saves}
            theme={rt.theme()}
            onOpen={(r, list) => rt.openReel(r, { list, viaPage: true })}
          />
        )}
      </Show>
      <Show when={rt.lightbox()} keyed>
        {(lb) => (
          <Lightbox
            store={lb.store}
            codes={lb.codes}
            start={lb.start}
            saves={rt.saves}
            deps={rt.deps}
            theme={rt.theme()}
            onClose={rt.closeLightbox}
          />
        )}
      </Show>
      <Show when={rt.outlierGrid()} keyed>
        {(store) => (
          <OutlierGrid store={store} saves={rt.saves} theme={rt.theme()} onOpen={(r) => rt.deps.openUrl(r.url)} onClose={rt.closeOutlierGrid} />
        )}
      </Show>
      <Show when={rt.scanPillStore()} keyed>
        {(store) => <ScanPill store={store} theme={rt.theme} />}
      </Show>
      <Show when={rt.panelStore()} keyed>
        {(store) => (
          <ProfilePanel
            store={store}
            saves={rt.saves}
            deps={rt.deps}
            theme={rt.theme()}
            onClose={rt.closePanel}
            onOpenReel={(r, list, event) => rt.openReel(r, { list, event })}
            keysTaken={() => rt.lightbox() != null || rt.stats.target() != null}
          />
        )}
      </Show>
      <Show when={rt.stats.target()} keyed>
        {(t) => (
          <StatsCard
            target={t}
            deps={rt.deps}
            theme={rt.theme()}
            creatorScan={rt.creatorScan}
            onCreatorPage={rt.onCreatorPage}
            onClose={(restore) => rt.stats.close(restore)}
          />
        )}
      </Show>
    </>
  );
}
