import reactiveContext from '../state/reactive-context.js';
import dialogService from './dialog-service.js';
import { createAdapterObservable } from './adapter-helpers.js';

type DialogLine = (typeof dialogService.signals.currentLine)['value'];
type DialogStatus = (typeof dialogService.signals.status)['value'];
type DialogChoice = (typeof dialogService.signals.choice)['value'];

const currentLine$ = createAdapterObservable<DialogLine>({
  name: 'dialog.currentLine',
  signal: dialogService.signals.currentLine
});

const history$ = createAdapterObservable<(NonNullable<DialogLine>)[]>({
  name: 'dialog.history',
  signal: dialogService.signals.history
});

const status$ = createAdapterObservable<DialogStatus>({
  name: 'dialog.status',
  signal: dialogService.signals.status
});

const choice$ = createAdapterObservable<DialogChoice>({
  name: 'dialog.choice',
  signal: dialogService.signals.choice
});

function subscribe(listener: (value: DialogLine) => void) {
  const subscription = reactiveContext.signalToObservable(dialogService.signals.currentLine).subscribe(listener);
  return () => {
    if (subscription && typeof subscription.unsubscribe === 'function') {
      subscription.unsubscribe();
    }
  };
}

export {
  currentLine$,
  history$,
  status$,
  choice$,
  subscribe
};

export default {
  getCurrentLine: dialogService.getCurrentLine,
  currentLine$,
  history$,
  status$,
  choice$,
  subscribe
};
