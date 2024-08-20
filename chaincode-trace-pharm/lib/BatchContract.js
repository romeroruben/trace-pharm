"use strict";

const { Contract } = require("fabric-contract-api");

class BatchContract extends Contract {
  async RegisterBatch(
    ctx,
    batchID,
    manufacturer,
    productionDate,
    expiryDate,
    transportCond,
    location,
    medicationName,
    medicationsJSON
  ) {
    // Validar que el usuario sea un "Fabricante"
    this._validateClientRole(ctx, "Fabricante");

    const estadoInicial = "Producción";
    const medications = JSON.parse(medicationsJSON);

    const batch = {
      ID: batchID,
      Manufacturer: manufacturer,
      MedicationName: medicationName,
      ProductionDate: productionDate,
      ExpiryDate: expiryDate,
      Medications: [],
      TransportCond: transportCond,
      Location: location,
      CurrentOwner: manufacturer,
      Status: estadoInicial,
    };

    for (const medication of medications) {
      const medicationData = {
        ID: medication.medicationID,
        BatchID: batchID,
        SerialNumber: medication.serialNumber,
        Name: medicationName,
        Manufacturer: manufacturer,
        ExpiryDate: medication.expiryDate,
        CurrentOwner: manufacturer,
        Location: location,
      };

      batch.Medications.push(medicationData.ID);
      await ctx.stub.putState(
        medication.medicationID,
        Buffer.from(JSON.stringify(medicationData))
      );
    }

    await ctx.stub.putState(batchID, Buffer.from(JSON.stringify(batch)));
  }

  async InitiateShipment(ctx, batchID, carrier) {
    // Validar que el usuario sea un "Distribuidor"
    this._validateClientRole(ctx, "Distribuidor");

    const batchAsBytes = await ctx.stub.getState(batchID);
    if (!batchAsBytes || batchAsBytes.length === 0) {
      throw new Error(`El lote ${batchID} no existe.`);
    }

    const batch = JSON.parse(batchAsBytes.toString());
    batch.Carrier = carrier;
    batch.Status = "En tránsito";

    await ctx.stub.putState(batchID, Buffer.from(JSON.stringify(batch)));
  }

  async UpdateEvent(ctx, batchID, location, temperature, humidity, timestamp) {
    const batch = await ctx.stub.getState(batchID);
    if (!batch || batch.length === 0) {
      throw new Error(`Batch ${batchID} does not exist`);
    }
    const batchJSON = JSON.parse(batch.toString());
    const newEvent = { location, temperature, humidity, timestamp };
    if(!batchJSON.events){
      batchJSON.events = [];
    }
    batchJSON.events.push(newEvent);
    await ctx.stub.putState(batchID, Buffer.from(JSON.stringify(batchJSON)));
  }

  async DeliverToPharmacy(ctx, batchID, pharmacyName) {
    // Validar que el usuario sea un "Distribuidor"
    this._validateClientRole(ctx, "Distribuidor");

    const batchAsBytes = await ctx.stub.getState(batchID);
    if (!batchAsBytes || batchAsBytes.length === 0) {
      throw new Error(`El lote ${batchID} no existe.`);
    }

    const batch = JSON.parse(batchAsBytes.toString());
    batch.CurrentOwner = pharmacyName;
    batch.Status = "En farmacia";

    await ctx.stub.putState(batchID, Buffer.from(JSON.stringify(batch)));
  }

  async ValidateAuthenticity(ctx, batchID) {
    // Validar que el usuario sea un "Auditor"
    this._validateClientRole(ctx, "Auditor");

    const batchAsBytes = await ctx.stub.getState(batchID);
    if (!batchAsBytes || batchAsBytes.length === 0) {
      throw new Error(`El lote ${batchID} no existe.`);
    }

    const batch = JSON.parse(batchAsBytes.toString());
    return JSON.stringify({
      ID: batch.ID,
      Manufacturer: batch.Manufacturer,
      MedicationName: batch.MedicationName,
      ProductionDate: batch.ProductionDate,
      ExpiryDate: batch.ExpiryDate,
      CurrentOwner: batch.CurrentOwner,
      Location: batch.Location,
      TransportCond: batch.TransportCond,
      Status: batch.Status,
      Medications: batch.Medications,
      events: batch.events,
    });
  }

  async ValidateMedication(ctx, medicationID) {
    this._validateClientRole(ctx, "Consumidor");

    // Obtener los datos del medicamento
    const medicationAsBytes = await ctx.stub.getState(medicationID);
    if (!medicationAsBytes || medicationAsBytes.length === 0) {
      throw new Error(`El medicamento ${medicationID} no existe.`);
    }
    const medication = JSON.parse(medicationAsBytes.toString());

    // Obtener los datos del lote asociado
    const batchAsBytes = await ctx.stub.getState(medication.BatchID);
    if (!batchAsBytes || batchAsBytes.length === 0) {
      throw new Error(`El lote asociado ${medication.BatchID} no existe.`);
    }
    const batch = JSON.parse(batchAsBytes.toString());

    // Construir la respuesta con la trazabilidad del lote
    return JSON.stringify({
      MedicationID: medication.ID,
      SerialNumber: medication.SerialNumber,
      Name: medication.Name,
      Manufacturer: medication.Manufacturer,
      ExpiryDate: medication.ExpiryDate,
      CurrentOwner: medication.CurrentOwner,
      Location: medication.Location,
      BatchID: batch.ID,
      BatchStatus: batch.Status,
      TransportEvents: batch.TransportEvents, // Incluir los eventos de transporte para la trazabilidad
    });
  }

  async AuditBatchHistory(ctx, batchID) {
    // Validar que el usuario sea un "Auditor"
    this._validateClientRole(ctx, "Auditor");

    const iterator = await ctx.stub.getHistoryForKey(batchID);
    const allResults = [];
    let res = { done: false };
    while (!res.done) {
      res = await iterator.next();
      if (res.value && res.value.value.toString()) {
        const jsonRes = {};
        jsonRes.TxId = res.value.tx_id;
        jsonRes.Timestamp = res.value.timestamp;
        jsonRes.IsDelete = res.value.is_delete.toString();
        try {
          jsonRes.Value = JSON.parse(res.value.value.toString());
        } catch (err) {
          jsonRes.Value = res.value.value.toString();
        }
        allResults.push(jsonRes);
      }
    }
    await iterator.close();
    return JSON.stringify(allResults);
  }

  _validateClientRole(ctx, expectedIdentity) {
    const clientIdentity = ctx.clientIdentity.attrs["hf.EnrollmentID"];

    if (clientIdentity !== expectedIdentity) {
      throw new Error(
        `Permiso denegado. Se requiere identidad de ${expectedIdentity}.`
      );
    }
  }
}

module.exports = BatchContract;
