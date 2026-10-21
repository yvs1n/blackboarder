import { describe, it, expect } from 'vitest';
import { isRemoteNewer, RemoteUpdateInfo, fetchRemoteGitHubVersion } from '../src/utils/updateChecker';
import { BUILD_INFO, BuildInfo } from '../src/buildInfo';

describe('Extension GitHub Update Checker Suite', () => {
  const mockLocal: BuildInfo = {
    version: '1.0.0',
    commit: '20bf1df90f2dfbe5b1350a938be2e84b66cdadaa',
    shortCommit: '20bf1df',
    timestamp: '2026-10-16T20:58:37Z',
    message: 'Initial local build',
    repo: 'yvs1n/blackboarder',
    branch: 'main'
  };

  it('detects no update when remote commit matches local commit', () => {
    const remote: RemoteUpdateInfo = {
      commit: '20bf1df90f2dfbe5b1350a938be2e84b66cdadaa',
      shortCommit: '20bf1df',
      timestamp: '2026-10-16T20:58:37Z',
      message: 'Initial local build',
      htmlUrl: 'https://github.com/yvs1n/blackboarder',
      downloadZipUrl: 'https://github.com/yvs1n/blackboarder/archive/refs/heads/main.zip',
      source: 'github-api'
    };

    expect(isRemoteNewer(remote, mockLocal)).toBe(false);
  });

  it('detects update when remote commit has newer timestamp', () => {
    const remote: RemoteUpdateInfo = {
      commit: 'abc1234567890abcdef1234567890abcdef12345',
      shortCommit: 'abc1234',
      timestamp: '2026-10-19T10:00:00Z',
      message: 'New features and fixes pushed to GitHub',
      htmlUrl: 'https://github.com/yvs1n/blackboarder',
      downloadZipUrl: 'https://github.com/yvs1n/blackboarder/archive/refs/heads/main.zip',
      source: 'github-api'
    };

    expect(isRemoteNewer(remote, mockLocal)).toBe(true);
  });

  it('does not treat older remote commit as an update', () => {
    const remote: RemoteUpdateInfo = {
      commit: '0000000000000000000000000000000000000000',
      shortCommit: '0000000',
      timestamp: '2026-10-01T00:00:00Z',
      message: 'Ancient commit',
      htmlUrl: 'https://github.com/yvs1n/blackboarder',
      downloadZipUrl: 'https://github.com/yvs1n/blackboarder/archive/refs/heads/main.zip',
      source: 'github-api'
    };

    expect(isRemoteNewer(remote, mockLocal)).toBe(false);
  });

  it('detects update when timestamps are missing or equal but commit differs', () => {
    const remote: RemoteUpdateInfo = {
      commit: 'fedcba9876543210fedcba9876543210fedcba98',
      shortCommit: 'fedcba9',
      timestamp: '',
      message: 'Fresh commit without timestamp',
      htmlUrl: 'https://github.com/yvs1n/blackboarder',
      downloadZipUrl: 'https://github.com/yvs1n/blackboarder/archive/refs/heads/main.zip',
      source: 'github-api'
    };

    expect(isRemoteNewer(remote, mockLocal)).toBe(true);
  });

  it('verifies BUILD_INFO contains valid repository and commit attributes', () => {
    expect(BUILD_INFO.repo).toBe('yvs1n/blackboarder');
    expect(BUILD_INFO.branch).toBe('main');
    expect(BUILD_INFO.commit).toBeDefined();
    expect(BUILD_INFO.shortCommit).toBeDefined();
    expect(BUILD_INFO.version).toBeDefined();
  });

  it('does not treat immediate post-build commit (parentCommit matches local) as a new update', () => {
    const remote: RemoteUpdateInfo = {
      commit: '9999999999999999999999999999999999999999',
      shortCommit: '9999999',
      parentCommit: '20bf1df90f2dfbe5b1350a938be2e84b66cdadaa',
      parentShortCommit: '20bf1df',
      timestamp: '2026-10-16T21:00:00Z', // 1m23s after local build
      message: 'Build and package commit',
      htmlUrl: 'https://github.com/yvs1n/blackboarder',
      downloadZipUrl: 'https://github.com/yvs1n/blackboarder/archive/refs/heads/main.zip',
      source: 'github-api'
    };

    expect(isRemoteNewer(remote, mockLocal)).toBe(false);
  });

  it('does not treat an already acknowledged commit as a new update', () => {
    const remote: RemoteUpdateInfo = {
      commit: 'abc1234567890abcdef1234567890abcdef12345',
      shortCommit: 'abc1234',
      timestamp: '2026-10-19T10:00:00Z',
      message: 'New features and fixes pushed to GitHub',
      htmlUrl: 'https://github.com/yvs1n/blackboarder',
      downloadZipUrl: 'https://github.com/yvs1n/blackboarder/archive/refs/heads/main.zip',
      source: 'github-api'
    };

    expect(isRemoteNewer(remote, mockLocal, 'abc1234')).toBe(false);
  });

  it('fetches remote commit details from GitHub or fallback endpoint', async () => {
    const remote = await fetchRemoteGitHubVersion();
    if (remote) {
      expect(remote.commit).toBeDefined();
      expect(remote.shortCommit).toBeDefined();
      expect(remote.downloadZipUrl).toContain('blackboarder');
      expect(['github-api', 'github-raw']).toContain(remote.source);
    }
  });

  it('preserves unpacked folder extension ID by omitting static key and includes in-place auto-updaters', () => {
    const fs = require('fs');
    const path = require('path');

    const manifest = JSON.parse(fs.readFileSync(path.resolve('public/manifest.json'), 'utf8'));
    expect(manifest.key).toBeUndefined();
    expect(manifest.permissions).toContain('downloads');

    expect(fs.existsSync(path.resolve('update.bat'))).toBe(true);
    expect(fs.existsSync(path.resolve('update.sh'))).toBe(true);

    const updateBat = fs.readFileSync(path.resolve('update.bat'), 'utf8');
    // The release zip is gitignored, so the updater must download the repository archive instead
    expect(updateBat).toContain('archive/refs/heads/main.zip');
    expect(updateBat).not.toContain('release/blackboarder-extension.zip');
    expect(updateBat).toContain('Expand-Archive');
  });
});


