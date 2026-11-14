// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root element');

const heading = document.createElement('h1');
heading.textContent = 'Lunar Landing Site Navigator';

const status = document.createElement('p');
status.textContent =
  'Under construction during the 2026 NASA Space Apps Challenge. The first working version will appear here shortly.';

root.append(heading, status);
