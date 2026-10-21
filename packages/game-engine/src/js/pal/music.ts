import traceModuleLoad from './util-trace';
import config from './config';
import worldService from '../../services/world-service.js';

traceModuleLoad('music module load');

type AudioElement = HTMLAudioElement & { dataset?: DOMStringMap };

const music = {
  // AUDIO_PlayMusic(num, loop, fade): num 0 stops the music, loop defaults to on, and nothing
  // plays while music is switched off in the system menu. (Fading is not implemented.)
  play(...args: any[]) {
    const track = Number(args[0]) || 0;
    const loop = args.length < 2 || args[1] !== false;
    worldService.setMusicTrack(track);
    log.debug(['[MUSIC] play'].concat(args).join(' '));
    if (track === 0 || worldService.getNoMusicFlag()) {
      music.stop();
      return;
    }
    if (!config.enableAudio || !config.audioBaseUrl) {
      log.trace('[MUSIC] audio disabled, skip %s', args[0]);
      return;
    }
    const audio = document.getElementById('bg-music') as AudioElement | null;
    const audioSource = audio && document.getElementById('bg-music-source') as HTMLSourceElement | null;
    if (!audio || !audioSource) {
      log.warn('[MUSIC] audio element not ready, skip');
      return;
    }
    const target = config.resolveAudioPath(String(args[0]) + '.mp3');
    if (!target) {
      log.trace('[MUSIC] audio path unavailable');
      return;
    }
    const current = audioSource.dataset ? audioSource.dataset.src : audioSource.getAttribute('data-src');
    if (current !== target) {
      if (audioSource.dataset) {
        audioSource.dataset.src = target;
      } else {
        audioSource.setAttribute('data-src', target);
      }
      audioSource.src = target;
      try {
        audio.pause();
        audio.load();
      } catch (ex: any) {
        log.warn('[MUSIC] preload failed: %s', ex && ex.message ? ex.message : ex);
      }
    }
    audio.pause();
    audio.loop = loop;
    let playPromise: Promise<void> | void;
    try {
      playPromise = audio.play();
    } catch (ex: any) {
      log.warn('[MUSIC] play failed: %s', ex && ex.message ? ex.message : ex);
      return;
    }
    if (playPromise && typeof (playPromise as any).catch === 'function') {
      (playPromise as any).catch((err: any) => {
        log.warn('[MUSIC] playback rejected: %s', err && err.message ? err.message : err);
      });
    }
  },
  stop() {
    if (typeof document === 'undefined') {
      return;
    }
    const audio = document.getElementById('bg-music') as AudioElement | null;
    if (audio && config.enableAudio) {
      try {
        audio.pause();
      } catch (ex: any) {
        log.warn('[MUSIC] stop failed: %s', ex && ex.message ? ex.message : ex);
      }
    }
  }
};

export default music;
