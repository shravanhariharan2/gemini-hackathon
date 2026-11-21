import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppHeader } from '../components/AppHeader';

test('shared header keeps identical navigation and highlights each current page', () => {
  for (const current of ['/', '/clip-gen', '/3d'] as const) {
    const html = renderToStaticMarkup(createElement(AppHeader, { current }));
    assert.match(html, /ClipThat/);
    assert.match(html, /Studio/);
    assert.match(html, /Clip Gen/);
    assert.match(html, /3D View/);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    assert.ok(html.includes(`href="${current}" aria-current="page"`));
  }
});

test('studio actions render outside the fixed shared header without appearing on other pages', () => {
  const html = renderToStaticMarkup(createElement(AppHeader, { current: '/', children: createElement('button', null, 'Go Live') }));
  assert.ok(html.indexOf('</header>') < html.indexOf('Go Live'));
  assert.doesNotMatch(renderToStaticMarkup(createElement(AppHeader, { current: '/3d' })), /Go Live/);
});
