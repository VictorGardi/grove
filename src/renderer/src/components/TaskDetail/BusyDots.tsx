import styles from "./BusyDots.module.css";

export function BusyDots() {
  return (
    <span className={styles.busyDots}>
      <span className={styles.dot}>.</span>
      <span className={styles.dot}>.</span>
      <span className={styles.dot}>.</span>
    </span>
  );
}
