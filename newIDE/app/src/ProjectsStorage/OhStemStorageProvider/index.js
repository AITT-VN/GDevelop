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
    const request = window.indexedDB.open(DB_NAME, 1);
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

const getCurrentSlotWithSeed = (): ?string => {
  if (typeof window === 'undefined' || !getLearnerId()) return null;
  const args = new URL(window.location.href).searchParams;
  const slot = args.get('slot');
  if (!slot || !isValidSlot(slot) || !args.get('seed') || args.get('template'))
    return null;
  return slot;
};

const getCurrentSlot = (): ?string => {
  if (typeof window === 'undefined' || !getLearnerId()) return null;
  const args = new URL(window.location.href).searchParams;
  const slot = args.get('slot');
  if (!slot || !isValidSlot(slot) || args.get('template')) return null;
  return slot;
};

/**
 * Store an imported ZIP. Inside a lesson slot the learner may replace that slot's
 * work (so reopening the lesson opens the imported project: next course's first
 * project lesson, another computer); otherwise, or on cancel, it becomes a copy.
 */
export const storeImportedProject = async (
  imported: StoredProject,
  name: string
): Promise<{| fileIdentifier: string, name: string |}> => {
  const slot = getCurrentSlot();
  if (
    slot &&
    window.confirm(
      'Dùng tệp ZIP này làm bài trong ô lưu của bài học hiện tại? Bài đang lưu trong ô này sẽ bị thay và không hoàn tác được. Bấm Huỷ để mở ZIP thành một bản sao riêng, không gắn với bài học.'
    )
  ) {
    const fileIdentifier = `slot:${slot}`;
    await writeStoredProject(fileIdentifier, imported);
    return { fileIdentifier, name };
  }
  const fileIdentifier = `copy:${window.crypto.randomUUID()}`;
  await writeStoredProject(fileIdentifier, imported);
  return { fileIdentifier, name };
};

/** Lessons open `?slot=<lesson>&seed=<sample>`, so a learner can start over. */
export const canResetSlotFromSeed = (): boolean => !!getCurrentSlotWithSeed();

export const resetSlotFromSeed = async (): Promise<void> => {
  const slot = getCurrentSlotWithSeed();
  if (!slot) return;
  if (
    !window.confirm(
      'Xoá bài đang làm trong ô lưu này và mở lại bản mẫu gốc? Không hoàn tác được. Muốn giữ bài, hãy tải bản ZIP trước.'
    )
  )
    return;
  try {
    const seed = new URL(window.location.href).searchParams.get('seed');
    if (!seed) return;
    // Fetch first: a failed download must never erase the learner's saved work.
    const project = await fetchProject(seed);
    if (!project || !project.properties || !Array.isArray(project.layouts))
      throw new Error('Invalid seed project.');
    // One transaction replaces only this learner's slot; abort keeps the old record.
    await writeStoredProject(`slot:${slot}`, { project, assets: {} });
    window.location.reload();
  } catch (error) {
    console.error('Could not restart the OhStem lesson from its seed.', error);
    window.alert(
      'Không thể mở lại bản mẫu. Bài đã lưu vẫn được giữ nguyên. Hãy kiểm tra kết nối và thử lại.'
    );
  }
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

// Resources of the open project, by URL: blob URLs created when opening it, and
// remote/data URLs already downloaded once. Saving reuses these Blobs instead of
// downloading every resource again, and keeps asset ids stable between saves.
type KnownAsset = {| assetId: string, blob: Blob |};
let knownAssets: Map<string, KnownAsset> = new Map<string, KnownAsset>();

const forgetOpenedAssets = () => {
  knownAssets.forEach((_, url) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  });
  knownAssets = new Map<string, KnownAsset>();
};

/** Asset id from the content, so the same file keeps the same id in every save. */
const contentAssetId = async (blob: Blob): Promise<string> => {
  const subtle = window.crypto && window.crypto.subtle;
  const anyBlob: any = blob;
  if (!subtle || typeof anyBlob.arrayBuffer !== 'function')
    return window.crypto.randomUUID();
  const digest = await subtle.digest('SHA-256', await anyBlob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

const materializeStoredProject = (record: StoredProject): Object => {
  // A newly opened project replaces the previous one: free its blob URLs.
  forgetOpenedAssets();
  let json = JSON.stringify(record.project);
  Object.keys(record.assets).forEach(assetId => {
    const blob = record.assets[assetId];
    const url = URL.createObjectURL(blob);
    knownAssets.set(url, { assetId, blob });
    json = json.split(`${ASSET_PREFIX}${assetId}`).join(url);
  });
  return JSON.parse(json);
};

export const createStoredProject = async (
  project: gdProject
): Promise<StoredProject> => {
  let json = JSON.stringify(serializeToJSObject(project));
  const assets: { [string]: Blob } = {};
  const resourceManager = project.getResourcesManager();
  const resourceNames = resourceManager.getAllResourceNames().toJSArray();

  for (const resourceName of resourceNames) {
    const file = resourceManager.getResource(resourceName).getFile();
    if (!/^(blob:|data:|https?:)/.test(file)) continue;
    let known: ?KnownAsset = knownAssets.get(file);
    if (!known) {
      const response = await fetch(file);
      if (!response.ok)
        throw new Error(`Cannot save the resource ${resourceName}.`);
      const blob = await response.blob();
      known = { assetId: await contentAssetId(blob), blob };
      knownAssets.set(file, known);
    }
    assets[known.assetId] = known.blob;
    json = json.split(file).join(`${ASSET_PREFIX}${known.assetId}`);
  }
  return { project: JSON.parse(json), assets };
};

const isQuotaError = (error: any): boolean =>
  !!error &&
  (error.name === 'QuotaExceededError' ||
    (!!error.inner && error.inner.name === 'QuotaExceededError'));

/** Write a learner's project, asking the browser to keep the data and explaining a full disk. */
export const saveStoredProject = async (
  fileIdentifier: string,
  record: StoredProject
): Promise<void> => {
  try {
    const storage: any =
      typeof navigator !== 'undefined' ? (navigator: any).storage : null;
    if (storage && typeof storage.persist === 'function')
      await storage.persist().catch(() => false);
    await writeStoredProject(fileIdentifier, record);
  } catch (error) {
    if (isQuotaError(error))
      throw new Error(
        'Trình duyệt đã hết chỗ lưu bài. Hãy tải bản ZIP của bài này về máy, xoá bớt dữ liệu trang web cũ hoặc nhờ thầy cô giải phóng dung lượng, rồi lưu lại.'
      );
    throw error;
  }
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
  const projectEntry = entries.find(
    entry =>
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
    const assetId = window.crypto.randomUUID();
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
      return { fileIdentifier: `copy:${window.crypto.randomUUID()}` };
    }
    if (slot) {
      if (!isValidSlot(slot)) throw new Error('Invalid slot name.');
      return { fileIdentifier: `slot:${slot}` };
    }
    return { fileIdentifier: 'slot:default' };
  },
  getProjectLocation: ({ projectName }) => ({
    fileIdentifier: `copy:${window.crypto.randomUUID()}`,
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
      return storeImportedProject(await importZip(file), file.name);
    },
    onSaveProject: async (project: gdProject, fileMetadata: FileMetadata) => {
      await saveStoredProject(
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
          ? { fileIdentifier: `copy:${window.crypto.randomUUID()}`, name }
          : null,
        saveAsOptions: null,
      };
    },
    onSaveProjectAs: async (project, saveAsLocation, options) => {
      options.onStartSaving();
      const fileIdentifier =
        (saveAsLocation && saveAsLocation.fileIdentifier) ||
        `copy:${window.crypto.randomUUID()}`;
      const fileMetadata = { fileIdentifier };
      await options.onMoveResources({ newFileMetadata: fileMetadata });
      await saveStoredProject(
        fileIdentifier,
        await createStoredProject(project)
      );
      return { wasSaved: true, fileMetadata };
    },
  }),
}: StorageProvider);
