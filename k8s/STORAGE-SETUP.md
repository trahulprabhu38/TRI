# Rancher Local Path Provisioner Setup

How to install Rancher's local-path-provisioner on the server and wire the
Mongo StatefulSet to it through a StorageClass. No PersistentVolume yaml —
the provisioner creates PVs automatically.

## How the pieces connect

```
mongo-statefulset.yml                volumes.yml                  (installed on server)
volumeClaimTemplates                 StorageClass                 local-path-provisioner
  storageClassName: local-path  -->    name: local-path      -->    watches PVCs, creates a PV
                                       rancher.io/local-path        under /opt/local-path-provisioner/
        |                                                                  |
        v                                                                  v
  PVC: mongo-persistent-storage-mongo-0  <-------- Bound --------  PV: pvc-xxxxxxxx (auto-created)
```

You write the StorageClass and the claim template. The provisioner does the
PV part for you.

## 1. Install the provisioner (on the server)

```bash
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.31/deploy/local-path-storage.yaml
```

Wait for it to come up:

```bash
kubectl get pods -n local-path-storage
# NAME                                     READY   STATUS
# local-path-provisioner-xxxxxxxxx-xxxxx   1/1     Running
```

## 2. Apply the StorageClass

`k8s/volumes.yml` now contains the StorageClass instead of a PV:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-path
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"   # makes it the cluster default
provisioner: rancher.io/local-path
reclaimPolicy: Retain              # deleting the PVC keeps the data on disk (safer for a DB)
volumeBindingMode: WaitForFirstConsumer
```

```bash
kubectl apply -f k8s/volumes.yml
kubectl get sc
# NAME                   PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE
# local-path (default)   rancher.io/local-path   Retain          WaitForFirstConsumer
```

Note: the install in step 1 also ships a `local-path` StorageClass; applying
`volumes.yml` on top just updates it (adds the default annotation + Retain).
That's expected.

## 3. Clean up the old static PV/PVC (if they exist on the server)

```bash
kubectl delete statefulset mongo -n tri --ignore-not-found
kubectl delete pvc mongo-persistent-storage-mongo-0 -n tri --ignore-not-found
kubectl delete pv mongo-pv --ignore-not-found
```

(The StatefulSet must be recreated anyway — `volumeClaimTemplates` is
immutable, you can't edit it in place.)

## 4. Deploy Mongo

`k8s/mongo-statefulset.yml` already points at the class:

```yaml
  volumeClaimTemplates:
    - metadata:
        name: mongo-persistent-storage
      spec:
        storageClassName: "local-path"
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 2Gi
```

```bash
kubectl apply -f k8s/mongo-statefulset.yml
```

## 5. Verify

```bash
kubectl get pvc -n tri
# mongo-persistent-storage-mongo-0   Bound   pvc-xxxxxxxx   2Gi   RWO   local-path

kubectl get pv
# pvc-xxxxxxxx   2Gi   RWO   Retain   Bound   tri/mongo-persistent-storage-mongo-0   local-path

kubectl get pods -n tri
# mongo-0   1/1   Running
```

The PVC stays `Pending` until the pod is scheduled — that's
`WaitForFirstConsumer` working, not an error. It binds when `mongo-0` starts.

Data lives on the server at `/opt/local-path-provisioner/pvc-xxxxxxxx_tri_mongo-persistent-storage-mongo-0/`.

## Gotchas

- **PVC stuck Pending with no pod?** Normal — it binds only when a pod using it is scheduled.
- **PVC stuck Pending with pod also Pending?** Check `kubectl -n local-path-storage logs deploy/local-path-provisioner`.
- **Because of `Retain`**: if you delete a PVC, the PV goes to `Released` and its data folder stays on disk. To reuse the name, `kubectl delete pv <name>` and remove the folder manually.
- **Scaling replicas**: each new mongo pod gets its own PVC and its own auto-created PV. Nothing extra to write.
