// data_sdk.js - Implementasi menggunakan Firebase Realtime Database dengan migrasi dari localStorage

class DataSDKFirebase {
  constructor() {
    if (!window.firebase) {
      throw new Error("Firebase SDK not loaded");
    }
    // Gunakan database instance yang sudah diinisialisasi di index.html
    this.dbRef = window.firebase.database().ref('absensi_data');
    this.dataHandler = null;
    this.initialized = false;
    this.localDataCache = []; // Untuk menyimpan data sementara sebelum onDataChanged
    this.migrationDone = false; // Flag untuk mencegah migrasi berulang
  }

  // Inisialisasi SDK dan hubungkan ke dataHandler
  init(handler) {
    return new Promise(async (resolve, reject) => { // Gunakan async karena migrasi bisa memakan waktu
      if (this.initialized) {
        reject({ isOk: false, error: "SDK already initialized" });
        return;
      }

      if (!handler || typeof handler.onDataChanged !== 'function') {
        reject({ isOk: false, error: "Invalid data handler" });
        return;
      }

      this.dataHandler = handler;
      this.initialized = true;

      // --- LANGKAH AWAL: MIGRASI DARI LOCALSTORAGE JIKA PERLU ---
      await this._attemptLocalStorageMigration();

      // --- HUBUNGKAN LISTENER KE FIREBASE ---
      this.dbRef.on('value', (snapshot) => {
        const firebaseData = snapshot.val();
        // Firebase mengembalikan object. Ubah ke array seperti yang diharapkan oleh handler.
        let newDataArray = [];
        if (firebaseData) {
          // Ambil item settings jika ada
          if (firebaseData.settings) {
            // Kita asumsikan hanya ada satu settings dengan key 'default_settings'
            if (firebaseData.settings.default_settings) {
              newDataArray.push({ ...firebaseData.settings.default_settings, id: 'default_settings', type: 'settings' }); // Tambahkan type jika tidak ada
            }
          }
          // Ambil item attendance jika ada
          if (firebaseData.attendance) {
            Object.keys(firebaseData.attendance).forEach(key => {
              newDataArray.push({ ...firebaseData.attendance[key], id: key });
            });
          }
        }
        // Update cache lokal
        this.localDataCache = newDataArray;
        // Panggil handler di UI
        if (this.dataHandler && typeof this.dataHandler.onDataChanged === 'function') {
          this.dataHandler.onDataChanged(newDataArray);
        }
      }, (error) => {
        console.error("Error listening to Firebase:", error);
        reject({ isOk: false, error: error.message });
      });

      resolve({ isOk: true });
    });
  }

  // Fungsi bantu untuk mencoba migrasi dari localStorage
  async _attemptLocalStorageMigration() {
    if (this.migrationDone) {
      console.log("Migration already done, skipping.");
      return;
    }

    try {
      const stored = localStorage.getItem('absensi_data'); // Ganti dengan kunci localStorage Anda sebelumnya jika berbeda
      if (!stored) {
        console.log("No data found in localStorage to migrate.");
        this.migrationDone = true;
        return;
      }

      console.log("Found data in localStorage, attempting migration...");
      let localData;
      try {
        localData = JSON.parse(stored);
      } catch (e) {
        console.error("Error parsing localStorage data:", e);
        // Jangan set flag jika parsing gagal, mungkin bisa dicoba lagi nanti
        return;
      }

      if (!Array.isArray(localData)) {
        console.error("localStorage data is not an array, cannot migrate.");
        this.migrationDone = true;
        return;
      }

      // Cek apakah Firebase sudah memiliki data attendance (jika iya, mungkin kita ingin melewati migrasi)
      // Kita perlu `once` untuk membaca data sekali
      const snapshot = await this.dbRef.child('attendance').once('value');
      if (snapshot.exists() && snapshot.numChildren() > 0) {
          console.log("Firebase already has attendance data, skipping localStorage migration.");
          this.migrationDone = true;
          // Hapus localStorage untuk mencegah percobaan migrasi berulang
          localStorage.removeItem('absensi_data');
          return;
      }

      // Cek apakah Firebase sudah memiliki settings default, jika tidak ada, migrasikan dari local jika ada
      const settingsSnapshot = await this.dbRef.child('settings/default_settings').once('value');
      if (!settingsSnapshot.exists()) {
          const localSettings = localData.find(item => item.type === 'settings');
          if (localSettings) {
              console.log("Migrating settings from localStorage...");
              // Jangan sertakan 'id' saat menyimpan ke Firebase settings default
              const settingsToSave = { ...localSettings };
              delete settingsToSave.id; // Hapus id karena kita gunakan key tetap 'default_settings'
              await this.dbRef.child('settings/default_settings').set(settingsToSave);
              console.log("Settings migrated successfully.");
          }
      } else {
          console.log("Firebase already has settings, skipping settings migration.");
      }

      // Migrasikan data absensi
      const attendanceItems = localData.filter(item => item.type === 'attendance');
      if (attendanceItems.length > 0) {
        console.log(`Found ${attendanceItems.length} attendance items to migrate.`);
        const attendanceRef = this.dbRef.child('attendance');
        for (const item of attendanceItems) {
            // Gunakan push untuk mendapatkan ID unik otomatis
            await attendanceRef.push(item);
            console.log(`Migrated attendance item for ${item.nama_lengkap}`);
        }
        console.log("Attendance items migrated successfully.");
      } else {
          console.log("No attendance items found in localStorage to migrate.");
      }

      console.log("Migration completed successfully.");
      this.migrationDone = true;
      // Hapus data dari localStorage setelah berhasil dimigrasi
      localStorage.removeItem('absensi_data');

    } catch (error) {
      console.error("Error during localStorage migration:", error);
      // Jangan set flag jika ada error kritis, mungkin bisa dicoba lagi
      // Tapi untuk sementara, set flag agar tidak mencoba terus-menerus jika error fatal
      this.migrationDone = true;
    }
  }


  // ... (sisanya fungsi create, update, delete tetap sama seperti sebelumnya) ...
  // Fungsi untuk membuat item baru (push ke Firebase)
  create(item) {
    return new Promise((resolve, reject) => {
      if (!this.initialized) {
        reject({ isOk: false, error: "SDK not initialized" });
        return;
      }

      if (!item || typeof item !== 'object' || !item.type) {
        reject({ isOk: false, error: "Invalid item for creation" });
        return;
      }

      try {
        let targetRef;
        if (item.type === 'settings') {
          // Gunakan key 'default_settings' agar hanya ada satu settings
          targetRef = this.dbRef.child('settings/default_settings');
          // Jangan sertakan 'id' saat menyimpan settings default
          const itemToSave = { ...item };
          delete itemToSave.id;
          targetRef.set(itemToSave)
            .then(() => resolve({ isOk: true }))
            .catch(error => reject({ isOk: false, error: error.message }));
        } else {
          // Untuk attendance atau tipe lainnya, gunakan push untuk ID unik otomatis
          targetRef = this.dbRef.child('attendance');
          targetRef.push(item)
            .then(() => resolve({ isOk: true }))
            .catch(error => reject({ isOk: false, error: error.message }));
        }
      } catch (e) {
        console.error("Error in create operation:", e);
        reject({ isOk: false, error: e.message });
      }
    });
  }

  // Fungsi untuk memperbarui item yang sudah ada (update di Firebase)
  update(item) {
    return new Promise((resolve, reject) => {
      if (!this.initialized) {
        reject({ isOk: false, error: "SDK not initialized" });
        return;
      }

      // Item harus memiliki 'id' untuk mengetahui item mana yang akan diupdate
      if (!item || typeof item !== 'object' || !item.type || !item.id) {
        reject({ isOk: false, error: "Invalid item for update (missing id)" });
        return;
      }

      try {
        let targetRef;
        if (item.type === 'settings') {
          targetRef = this.dbRef.child(`settings/${item.id}`);
        } else {
          targetRef = this.dbRef.child(`attendance/${item.id}`);
        }
        // Jangan sertakan 'id' saat menyimpan ke Firebase
        const itemToSave = { ...item };
        delete itemToSave.id;
        targetRef.set(itemToSave)
          .then(() => resolve({ isOk: true }))
          .catch(error => reject({ isOk: false, error: error.message }));
      } catch (e) {
        console.error("Error in update operation:", e);
        reject({ isOk: false, error: e.message });
      }
    });
  }

  // Fungsi untuk menghapus item (hapus dari Firebase)
  delete(item) {
    return new Promise((resolve, reject) => {
      if (!this.initialized) {
        reject({ isOk: false, error: "SDK not initialized" });
        return;
      }

      // Item harus memiliki 'id' dan 'type' untuk mengetahui item mana yang akan dihapus
      if (!item || typeof item !== 'object' || !item.type || !item.id) {
        reject({ isOk: false, error: "Invalid item for deletion (missing id or type)" });
        return;
      }

      try {
        let targetRef;
        if (item.type === 'settings') {
          targetRef = this.dbRef.child(`settings/${item.id}`);
        } else {
          targetRef = this.dbRef.child(`attendance/${item.id}`);
        }
        targetRef.remove()
          .then(() => resolve({ isOk: true }))
          .catch(error => reject({ isOk: false, error: error.message }));
      } catch (e) {
        console.error("Error in delete operation:", e);
        reject({ isOk: false, error: e.message });
      }
    });
  }
}

// Ekspor global untuk digunakan oleh index.html
window.dataSdk = new DataSDKFirebase();