// @flow
import { t } from '@lingui/macro';
import { type StorageProvider, type FileMetadata } from '..';
import { serializeToJSObject } from '../../Utils/Serializer';
import { initializeZipJs } from '../../Utils/Zip.js';
import { getLearnerId, isValidSlot } from '../../OhStem/Config';
import { type AppArguments } from '../../Utils/Window';

const DB_NAME = 'ohstem-game-studio';
const STORE_NAME = 'projects';
const ASSET_PREFIX = 'ohstem-asset://';
const gd: libGDevelop = global.gd;

type StoredProject = {|
  project: Object,
  assets: { [string]: Blob },
|};

let databasePromise: ?Promise<IDBDatabase> = null;
const openDatabase = (): Promise<IDBDatabase> => {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
};

const getKey = (fileIdentifier: string): string => {
  const learner = getLearnerId();
  if (!learner) throw new Error('A valid learner code is required.');
  return `${learner}:${fileIdentifier}`;
};

const readStoredProject = async (
  fileIdentifier: string
): Promise<?StoredProject> => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .get(getKey(fileIdentifier));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const writeStoredProject = async (
  fileIdentifier: string,
  record: StoredProject
): Promise<void> => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record, getKey(fileIdentifier));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

const fetchProject = async (url: string): Promise<Object> => {
  const parsedUrl = new URL(url);
  if (!['https:', 'http:'].includes(parsedUrl.protocol))
    throw new Error('The project URL must use HTTP or HTTPS.');
  const response = await fetch(parsedUrl.href, { credentials: 'omit' });
  if (!response.ok)
    throw new Error(`Cannot open the project (${response.status}).`);
  const project = await response.json();
  // Template and seed assets may be relative to the project JSON URL.
  const resolveFiles = value => {
    if (Array.isArray(value)) return value.forEach(resolveFiles);
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach(key => {
      if (
        key === 'file' &&
        typeof value[key] === 'string' &&
        value[key] &&
        !/^(https?:|blob:|data:)/.test(value[key])
      ) {
        value[key] = new URL(value[key], parsedUrl).href;
      } else {
        resolveFiles(value[key]);
      }
    });
  };
  resolveFiles(project.resources);
  return project;
};

const blankProject = (): Object => {
  const project = gd.ProjectHelper.createNewGDJSProject();
  try {
    return serializeToJSObject(project);
  } finally {
    project.delete();
  }
};

const materializeStoredProject = (record: StoredProject): Object => {
  let json = JSON.stringify(record.project);
  Object.keys(record.assets).forEach(assetId => {
    const url = URL.createObjectURL(record.assets[assetId]);
    json = json.split(`${ASSET_PREFIX}${assetId}`).join(url);
  });
  return JSON.parse(json);
};

const createStoredProject = async (project: gdProject): Promise<StoredProject> => {
  let json = JSON.stringify(serializeToJSObject(project));
  const assets = {};
  const resourceManager = project.getResourcesManager();
  const resourceNames = resourceManager.getAllResourceNames().toJSArray();
  const urlToAssetId = new Map();

  for (const resourceName of resourceNames) {
    const file = resourceManager.getResource(resourceName).getFile();
    if (!/^(blob:|data:|https?:)/.test(file)) continue;
    let assetId = urlToAssetId.get(file);
    if (!assetId) {
      const response = await fetch(file);
      if (!response.ok)
        throw new Error(`Cannot save the resource ${resourceName}.`);
      assetId = crypto.randomUUID();
      assets[assetId] = await response.blob();
      urlToAssetId.set(file, assetId);
    }
    json = json.split(file).join(`${ASSET_PREFIX}${assetId}`);
  }
  return { project: JSON.parse(json), assets };
};

const readZipEntry = (entry: Object, writer: Object): Promise<any> =>
  new Promise(resolve => entry.getData(writer, resolve));

const importZip = async (file: File): Promise<StoredProject> => {
  const zip = await initializeZipJs();
  const entries: Array<Object> = await new Promise((resolve, reject) => {
    zip.createReader(
      new zip.BlobReader(file),
      reader => reader.getEntries(resolve),
      reject
    );
  });
  const projectEntry = entries.find(entry =>
    entry.filename.endsWith('/game.json') || entry.filename === 'game.json'
  );
  if (!projectEntry) throw new Error('ZIP has no game.json.');
  const projectDirectory = projectEntry.filename.slice(0, -'game.json'.length);
  const project = JSON.parse(
    await readZipEntry(projectEntry, new zip.TextWriter())
  );
  const assets = {};
  const assetNames = new Map();
  for (const entry of entries) {
    if (entry.directory || entry === projectEntry) continue;
    const assetId = crypto.randomUUID();
    assets[assetId] = await readZipEntry(entry, new zip.BlobWriter());
    assetNames.set(entry.filename, `${ASSET_PREFIX}${assetId}`);
    if (projectDirectory && entry.filename.startsWith(projectDirectory)) {
      assetNames.set(
        entry.filename.slice(projectDirectory.length),
        `${ASSET_PREFIX}${assetId}`
      );
    }
  }
  const replacePaths = value => {
    if (typeof value === 'string') return assetNames.get(value) || value;
    if (Array.isArray(value)) return value.map(replacePaths);
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(key => {
        value[key] = replacePaths(value[key]);
      });
    }
    return value;
  };
  return { project: replacePaths(project), assets };
};

const pickZipFile = (): Promise<?File> =>
  new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = () => resolve(input.files && input.files[0]);
    input.click();
  });

export default ({
  internalName: 'OhStem',
  name: t`OhStem Game Studio`,
  getFileMetadataFromAppArguments: (args: AppArguments): ?FileMetadata => {
    if (!getLearnerId()) return null;
    const template = args.template;
    const slot = args.slot;
    if (template && slot)
      throw new Error('Use either template or slot, not both.');
    if (template) {
      return { fileIdentifier: `copy:${crypto.randomUUID()}` };
    }
    if (slot) {
      if (!isValidSlot(slot)) throw new Error('Invalid slot name.');
      return { fileIdentifier: `slot:${slot}` };
    }
    return { fileIdentifier: 'slot:default' };
  },
  getProjectLocation: ({ projectName }) => ({
    fileIdentifier: `copy:${crypto.randomUUID()}`,
    name: projectName,
  }),
  createOperations: () => ({
    onOpen: async (fileMetadata: FileMetadata) => {
      const fileIdentifier = fileMetadata.fileIdentifier;
      const storedProject = await readStoredProject(fileIdentifier);
      if (storedProject)
        return { content: materializeStoredProject(storedProject) };

      const args = new URL(window.location.href).searchParams;
      if (fileIdentifier.startsWith('slot:')) {
        const seed = args.get('seed');
        return { content: seed ? await fetchProject(seed) : blankProject() };
      }
      if (fileIdentifier.startsWith('copy:')) {
        const template = args.get('template');
        if (template) return { content: await fetchProject(template) };
      }
      throw new Error('Project not found in this learner workspace.');
    },
    onOpenWithPicker: async () => {
      const file = await pickZipFile();
      if (!file) return null;
      const fileIdentifier = `copy:${crypto.randomUUID()}`;
      await writeStoredProject(fileIdentifier, await importZip(file));
      return { fileIdentifier, name: file.name };
    },
    onSaveProject: async (project: gdProject, fileMetadata: FileMetadata) => {
      await writeStoredProject(
        fileMetadata.fileIdentifier,
        await createStoredProject(project)
      );
      return {
        wasSaved: true,
        fileMetadata: { ...fileMetadata, lastModifiedDate: Date.now() },
      };
    },
    onChooseSaveProjectAsLocation: async ({ project }) => {
      const name = window.prompt('Tên bản sao dự án', project.getName());
      return {
        saveAsLocation: name
          ? { fileIdentifier: `copy:${crypto.randomUUID()}`, name }
          : null,
        saveAsOptions: null,
      };
    },
    onSaveProjectAs: async (project, saveAsLocation, options) => {
      options.onStartSaving();
      const fileIdentifier =
        (saveAsLocation && saveAsLocation.fileIdentifier) ||
        `copy:${crypto.randomUUID()}`;
      const fileMetadata = { fileIdentifier };
      await options.onMoveResources({ newFileMetadata: fileMetadata });
      await writeStoredProject(fileIdentifier, await createStoredProject(project));
      return { wasSaved: true, fileMetadata };
    },
  }),
}: StorageProvider);
