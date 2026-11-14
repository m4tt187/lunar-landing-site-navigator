// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { render } from 'preact';
import { App } from './app';
import { loadData } from './data';
import { data, decodeState, defaultStart, loadError, newId, scenarios, selectedId } from './state';
import './styles.css';

loadData().then(
  (app) => {
    if (!decodeState(location.hash, app)) {
      const start = defaultStart();
      const list = [
        { id: newId(), siteId: 'im-2-athena', custom: null, mastM: 2, startMs: start },
        { id: newId(), siteId: 'feature-16338', custom: null, mastM: 2, startMs: start },
      ];
      scenarios.value = list;
      selectedId.value = list[0]!.id;
    }
    data.value = app;
  },
  (error: unknown) => { loadError.value = String(error); },
);

render(<App />, document.querySelector('#app')!);
