// @flow
import * as React from 'react';
import MainFrame from './MainFrame';
import Window from './Utils/Window';
import ShareDialog from './ExportAndShare/ShareDialog';
import Dialog from './UI/Dialog';
import FlatButton from './UI/FlatButton';
import Authentication from './Utils/GDevelopServices/Authentication';
import './UI/icomoon-font.css'; // Styles for Icomoon font.

// Import for browser only IDE
import browserResourceSources from './ResourcesList/BrowserResourceSources';
import browserResourceExternalEditors from './ResourcesList/BrowserResourceExternalEditors';
import BrowserSWPreviewLauncher from './ExportAndShare/BrowserExporters/BrowserSWPreviewLauncher';
import BrowserS3PreviewLauncher from './ExportAndShare/BrowserExporters/BrowserS3PreviewLauncher';
import {
  browserAutomatedExporters,
  browserManualExporters,
  browserOnlineWebExporter,
} from './ExportAndShare/BrowserExporters';
import makeExtensionsLoader from './JsExtensionsLoader/BrowserJsExtensionsLoader';
import ObjectsEditorService from './ObjectEditor/ObjectsEditorService';
import ObjectsRenderingService from './ObjectsRendering/ObjectsRenderingService';
import { makeBrowserSWEventsFunctionCodeWriter } from './EventsFunctionsExtensionsLoader/CodeWriters/BrowserSWEventsFunctionCodeWriter';
import { makeBrowserS3EventsFunctionCodeWriter } from './EventsFunctionsExtensionsLoader/CodeWriters/BrowserS3EventsFunctionCodeWriter';
import Providers from './MainFrame/Providers';
import ProjectStorageProviders from './ProjectsStorage/ProjectStorageProviders';
import UrlStorageProvider from './ProjectsStorage/UrlStorageProvider';
import DownloadFileStorageProvider from './ProjectsStorage/DownloadFileStorageProvider';
import CloudStorageProvider from './ProjectsStorage/CloudStorageProvider';
import OhStemStorageProvider from './ProjectsStorage/OhStemStorageProvider';
import { isOhStemMode, getLearnerId } from './OhStem/Config';
import BrowserResourceMover from './ProjectsStorage/ResourceMover/BrowserResourceMover';
import BrowserResourceFetcher from './ProjectsStorage/ResourceFetcher/BrowserResourceFetcher';
import BrowserEventsFunctionsExtensionOpener from './EventsFunctionsExtensionsLoader/Storage/BrowserEventsFunctionsExtensionOpener';
import BrowserEventsFunctionsExtensionWriter from './EventsFunctionsExtensionsLoader/Storage/BrowserEventsFunctionsExtensionWriter';
import BrowserLoginProvider from './LoginProvider/BrowserLoginProvider';
import { isServiceWorkerSupported } from './ServiceWorkerSetup';
import { ensureBrowserSWPreviewSession } from './ExportAndShare/BrowserExporters/BrowserSWPreviewLauncher/BrowserSWPreviewIndexedDB';

export const create = (authentication: Authentication): React.Node => {
  if (isOhStemMode && !getLearnerId()) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
        OhStem Game Studio cần mã học sinh hợp lệ trong tham số URL
        <code> learner=</code>.
      </div>
    );
  }
  Window.setUpContextMenu();
  const loginProvider = new BrowserLoginProvider(authentication.auth);
  authentication.setLoginProvider(loginProvider);

  let app = null;
  const appArguments = Window.getArguments();

  // TODO: make a hook that allows this to change, so we can switch to S3
  // (and log this into Posthog).
  const canUseBrowserSW = isServiceWorkerSupported();
  if (canUseBrowserSW) ensureBrowserSWPreviewSession();
  if (isOhStemMode && !canUseBrowserSW) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
        Trình duyệt này chưa hỗ trợ Service Worker cần cho phần xem thử
        của OhStem Game Studio.
      </div>
    );
  }

  app = (
    <Providers
      authentication={authentication}
      disableCheckForUpdates={!!appArguments['disable-update-check']}
      makeEventsFunctionCodeWriter={
        canUseBrowserSW
          ? makeBrowserSWEventsFunctionCodeWriter
          : makeBrowserS3EventsFunctionCodeWriter
      }
      // $FlowFixMe[incompatible-type]
      // $FlowFixMe[incompatible-exact]
      eventsFunctionsExtensionWriter={BrowserEventsFunctionsExtensionWriter}
      // $FlowFixMe[incompatible-type]
      // $FlowFixMe[incompatible-exact]
      eventsFunctionsExtensionOpener={BrowserEventsFunctionsExtensionOpener}
    >
      {({ i18n }) => (
        <ProjectStorageProviders
          appArguments={appArguments}
          storageProviders={
            isOhStemMode
              ? [OhStemStorageProvider, DownloadFileStorageProvider]
              : [
                  UrlStorageProvider,
                  CloudStorageProvider,
                  DownloadFileStorageProvider,
                ]
          }
          defaultStorageProvider={
            isOhStemMode ? OhStemStorageProvider : UrlStorageProvider
          }
        >
          {({
            getStorageProviderOperations,
            getStorageProviderResourceOperations,
            storageProviders,
            initialFileMetadataToOpen,
            getStorageProvider,
          }) => (
            <MainFrame
              i18n={i18n}
              useCliCommandRunner={() => {}}
              renderPreviewLauncher={(props, ref) =>
                canUseBrowserSW ? (
                  // $FlowFixMe[incompatible-type]
                  <BrowserSWPreviewLauncher {...props} ref={ref} />
                ) : (
                  // $FlowFixMe[incompatible-type]
                  <BrowserS3PreviewLauncher {...props} ref={ref} />
                )
              }
              renderShareDialog={props =>
                isOhStemMode ? (
                  <Dialog
                    title="Xuất bản trò chơi"
                    open
                    onRequestClose={props.onClose}
                    actions={[
                      <FlatButton
                        key="close"
                        label="Đóng"
                        onClick={props.onClose}
                      />,
                    ]}
                  >
                    Xuất bản thành link OhStem đang được triển khai. Để lưu một
                    bản ZIP dự án, chọn Tệp → Lưu thành → Tải bản sao.
                  </Dialog>
                ) : (
                <ShareDialog
                  project={props.project}
                  onSaveProject={props.onSaveProject}
                  isSavingProject={props.isSavingProject}
                  onChangeSubscription={props.onChangeSubscription}
                  onClose={props.onClose}
                  automatedExporters={browserAutomatedExporters}
                  manualExporters={browserManualExporters}
                  onlineWebExporter={browserOnlineWebExporter}
                  allExportersRequireOnline
                  fileMetadata={props.fileMetadata}
                  storageProvider={props.storageProvider}
                  initialTab={props.initialTab}
                  gamesList={props.gamesList}
                />
                )
              }
              quickPublishOnlineWebExporter={browserOnlineWebExporter}
              storageProviders={storageProviders}
              resourceMover={BrowserResourceMover}
              resourceFetcher={BrowserResourceFetcher}
              getStorageProviderOperations={getStorageProviderOperations}
              getStorageProviderResourceOperations={
                getStorageProviderResourceOperations
              }
              getStorageProvider={getStorageProvider}
              resourceSources={browserResourceSources}
              resourceExternalEditors={browserResourceExternalEditors}
              extensionsLoader={makeExtensionsLoader({
                objectsEditorService: ObjectsEditorService,
                objectsRenderingService: ObjectsRenderingService,
                filterExamples: !Window.isDev(),
              })}
              initialFileMetadataToOpen={initialFileMetadataToOpen}
              initialExampleSlugToOpen={
                appArguments['create-from-example'] || null
              }
            />
          )}
        </ProjectStorageProviders>
      )}
    </Providers>
  );

  return app;
};
