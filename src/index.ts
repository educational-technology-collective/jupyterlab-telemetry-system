import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { INotebookContent } from '@jupyterlab/nbformat';
import { Token } from '@lumino/coreutils';
import { requestAPI } from './handler';
import { producerCollection } from './producer';
import { ActiveEvent, Config, Exporter } from './types';

const PLUGIN_ID = 'jupyterlab-pioneer:plugin';

export const IJupyterLabPioneer = new Token<IJupyterLabPioneer>(PLUGIN_ID);

export interface IJupyterLabPioneer {
  /**
   * Send event data to exporters defined in the configuration file.
   *
   * @param {NotebookPanel} notebookPanel The notebook panel the extension currently listens to.
   * @param {Object} eventDetail An object containing event details
   * @param {Boolean} logNotebookContent A boolean indicating whether to log the entire notebook or not
   */
  publishEvent(
    notebookPanel: NotebookPanel,
    eventDetail: Object,
    logWholeNotebook?: Boolean,
    exporter?: Exporter
  ): Promise<void>;
}

class JupyterLabPioneer implements IJupyterLabPioneer {
  async publishEvent(
    notebookPanel: NotebookPanel,
    eventDetail: Object,
    logWholeNotebook?: Boolean,
    exporter?: Exporter
  ) {
    if (!notebookPanel) {
      throw Error('router is listening to a null notebook panel');
    }
    const requestBody = {
      eventDetail: eventDetail,
      notebookState: {
        sessionID: notebookPanel?.sessionContext.session?.id,
        notebookPath: notebookPanel?.context.path,
        notebookContent: logWholeNotebook
          ? (notebookPanel?.model?.toJSON() as INotebookContent)
          : null // decide whether to log the entire notebook
      },
      exporter: exporter
    };
    const response = await requestAPI<any>('export', {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });
    console.log(response);
  }
}

const plugin: JupyterFrontEndPlugin<JupyterLabPioneer> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [INotebookTracker],
  provides: IJupyterLabPioneer,
  activate: async (app: JupyterFrontEnd, notebookTracker: INotebookTracker) => {
    const version = await requestAPI<string>('version');
    console.log(`${PLUGIN_ID}: ${version}`);

    // TODO: get config from metadata. If not found, use server config.
    const config = (await requestAPI<any>('config')) as Config;
    const activeEvents: ActiveEvent[] = config.activeEvents;
    const exporters: Exporter[] = config.exporters;
    console.log(config);

    const processedExporters =
      activeEvents && activeEvents.length
        ? exporters.map(e => {
            if (!e.activeEvents) {
              e.activeEvents = activeEvents;
              return e;
            } else {
              return e;
            }
          })
        : exporters.filter(e => e.activeEvents && e.activeEvents.length);

    console.log(processedExporters);

    const pioneer = new JupyterLabPioneer();

    notebookTracker.widgetAdded.connect(
      async (_, notebookPanel: NotebookPanel) => {
        await notebookPanel.revealed;
        await notebookPanel.sessionContext.ready;

        processedExporters.forEach(exporter => {
          producerCollection.forEach(producer => {
            if (exporter.activeEvents?.map(o => o.name).includes(producer.id)) {
              new producer().listen(notebookPanel, pioneer, exporter);
            }
          });
        });
      }
    );

    return pioneer;
  }
};

export default plugin;
